import { readFile, writeFile } from 'node:fs/promises';
import { oauth2AccessToken, uploadImageFromUrl } from './x.js';

const FEED_URL = process.env.LETTERBOXD_RSS_URL ?? 'https://letterboxd.com/charlie_white/rss/';
const LETTERBOXD_PROFILE_URL = process.env.LETTERBOXD_PROFILE_URL ?? 'https://letterboxd.com/charlie_white/';
const TMDB_API_READ_ACCESS_TOKEN = process.env.TMDB_API_READ_ACCESS_TOKEN;
const STATE_FILE = new URL('../last-posted.json', import.meta.url);
// X cuenta 280 «unidades»: cada URL pesa 23 pase lo que pase y los caracteres
// fuera de los rangos latinos básicos (emojis y estrellas incluidos) pesan 2.
const POST_LIMIT = 280;
const URL_PATTERN = /https?:\/\/\S+/gi;

function decode(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();
}

function tag(xml, name) {
  return decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
}

function extractReview(description) {
  return decode(description
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<p>\s*Watched on\b[\s\S]*?<\/p>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?(?:p|div|span)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim());
}

function parseFeed(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const feedTitle = tag(item, 'title').replace(/<[^>]+>/g, '').trim();
    const link = tag(item, 'link');
    const id = tag(item, 'guid') || link;
    const description = tag(item, 'description');
    const review = extractReview(description);
    const image = description.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
      ?? item.match(/<media:content[^>]+url=["']([^"']+)["']/i)?.[1];
    const filmTitle = tag(item, 'letterboxd:filmTitle')
      || feedTitle.replace(/\s*,?\s*\d{4}\s*[-–—:]?\s*[★½]+\s*$/, '').trim();
    const year = tag(item, 'letterboxd:filmYear')
      || feedTitle.match(/,\s*(\d{4})\s*[-–—:]?\s*[★½]+\s*$/)?.[1]
      || '';
    const memberRating = tag(item, 'letterboxd:memberRating');
    const ratingValue = Number(memberRating);
    const ratingText = memberRating
      ? '⭐'.repeat(Math.floor(ratingValue)) + (ratingValue % 1 >= 0.5 ? '½' : '')
      : '';
    return { id, title: filmTitle, year, rating: ratingText, review, link, image, tmdbId: tag(item, 'tmdb:movieId') };
  }).filter((entry) => entry.id && entry.title && entry.rating);
  // El RSS mezcla las entradas del diario con las listas del perfil
  // (`letterboxd-list-*`), que no llevan `memberRating`: exigir una valoración
  // deja fuera las listas y las películas vistas pero aún sin puntuar.
}

function normalizeTitle(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

async function tmdb(path, params = {}) {
  const query = new URLSearchParams({ language: 'en-US', ...params });
  const response = await fetch(`https://api.themoviedb.org/3${path}?${query}`, {
    headers: { Authorization: `Bearer ${TMDB_API_READ_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    console.warn(`TMDB respondió ${response.status} en ${path}.`);
    return null;
  }
  return response.json();
}

async function tmdbPosterUrl(entry) {
  if (!TMDB_API_READ_ACCESS_TOKEN) return entry.image;

  try {
    // El RSS de Letterboxd ya trae <tmdb:movieId>, así que pedimos la ficha
    // exacta en lugar de adivinarla buscando por título.
    if (entry.tmdbId) {
      const film = await tmdb(`/movie/${entry.tmdbId}`);
      if (film?.poster_path) return `https://image.tmdb.org/t/p/w500${film.poster_path}`;
    }

    const params = { query: entry.title };
    if (entry.year) params.primary_release_year = entry.year;
    const { results = [] } = (await tmdb('/search/movie', params)) ?? {};
    const title = normalizeTitle(entry.title);
    const match = results.find((film) => {
      const titleMatches = [film.title, film.original_title].some((candidate) => normalizeTitle(candidate) === title);
      const yearMatches = !entry.year || film.release_date?.startsWith(`${entry.year}-`);
      return titleMatches && yearMatches && film.poster_path;
    });

    if (!match) {
      console.warn(`TMDB no encontró una coincidencia segura para «${entry.title}»${entry.year ? ` (${entry.year})` : ''}; usaré la imagen del RSS si existe.`);
      return entry.image;
    }
    return `https://image.tmdb.org/t/p/w500${match.poster_path}`;
  } catch (error) {
    console.warn(`Error consultando TMDB (${error.message}); usaré la imagen del RSS si existe.`);
    return entry.image;
  }
}

function postLength(text) {
  const urls = text.match(URL_PATTERN) ?? [];
  let weight = urls.length * 23;
  for (const char of text.replace(URL_PATTERN, '')) {
    const code = char.codePointAt(0);
    const light = code <= 0x10ff
      || (code >= 0x2000 && code <= 0x200d)
      || (code >= 0x2010 && code <= 0x201f)
      || (code >= 0x2032 && code <= 0x2037);
    weight += light ? 1 : 2;
  }
  return weight;
}

function composeText(entry, review) {
  const header = `🍿 Acabo de ver '${entry.title}'${entry.year ? ` (${entry.year})` : ''}`;
  const details = [entry.rating, review].filter(Boolean).join('\n');
  return `${[header, details].filter(Boolean).join('\n')}\n\n${LETTERBOXD_PROFILE_URL}`;
}

function buildText(entry) {
  const full = composeText(entry, entry.review);
  if (postLength(full) <= POST_LIMIT) return full;

  // Recortamos la reseña palabra a palabra hasta que el post entra en el límite;
  // si ni siquiera cabe sin reseña, cortamos el texto entero por caracteres.
  let review = '';
  for (const word of entry.review.split(/\s+/)) {
    const candidate = review ? `${review} ${word}` : word;
    if (postLength(composeText(entry, `${candidate}…`)) > POST_LIMIT) break;
    review = candidate;
  }
  const trimmed = composeText(entry, review ? `${review}…` : '');
  if (postLength(trimmed) <= POST_LIMIT) return trimmed;

  const characters = [...trimmed];
  while (characters.length && postLength(characters.join('')) > POST_LIMIT) characters.pop();
  return characters.join('');
}

async function publish(entry, accessToken) {
  const posterUrl = await tmdbPosterUrl(entry);
  let media;
  if (posterUrl) {
    try {
      media = await uploadImageFromUrl(posterUrl, accessToken);
    } catch (error) {
      // Publicamos igualmente: si no, la entrada se queda atascada y el workflow
      // reintenta la misma película cada 15 minutos sin publicar nada.
      console.warn(`No se pudo adjuntar la portada de «${entry.title}» (${error.message}); publico solo el texto.`);
    }
  } else {
    console.warn(`Sin portada disponible para «${entry.title}»; publico solo el texto.`);
  }

  const text = buildText(entry);
  const body = { text, ...(media ? { media: { media_ids: [media.id] } } : {}) };
  const endpoint = 'https://api.x.com/2/tweets';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 402) {
      // Pago por uso: sin saldo X no acepta escrituras. No es un fallo de
      // credenciales ni de código, así que lo decimos sin stack trace.
      throw new Error('El proyecto de X se ha quedado sin créditos (402). Recárgalos en Facturación → Créditos de la consola; la valoración queda en cola y se publicará en la siguiente ejecución.');
    }
    throw new Error(`X rechazó la publicación (${response.status}): ${detail}`);
  }
  console.log(`Publicado${media ? ` con portada (subida con ${media.via})` : ' sin portada'}: ${text}`);
}

async function readState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

process.on('uncaughtException', (error) => {
  // Un fallo esperable (sin créditos, RSS caído) no necesita volcar la pila.
  console.error(error.message);
  process.exit(1);
});

const response = await fetch(FEED_URL, { headers: { 'User-Agent': 'letterboxd-to-x/1.0' } });
if (!response.ok) throw new Error(`No se pudo leer el RSS (${response.status})`);
const entries = parseFeed(await response.text());
if (!entries.length) throw new Error('El RSS no contiene valoraciones reconocibles');

const state = await readState();
if (!state.lastPostedId) {
  await writeFile(STATE_FILE, `${JSON.stringify({ lastPostedId: entries[0].id }, null, 2)}\n`);
  console.log(`Punto de partida guardado: ${entries[0].title}. Las nuevas valoraciones se publicarán en las siguientes ejecuciones.`);
} else {
  const lastIndex = entries.findIndex((entry) => entry.id === state.lastPostedId);
  const pending = lastIndex === -1 ? [entries[0]] : entries.slice(0, lastIndex).reverse();
  if (pending.length) {
    const accessToken = await oauth2AccessToken();
    for (const entry of pending) {
      await publish(entry, accessToken);
      await writeFile(STATE_FILE, `${JSON.stringify({ lastPostedId: entry.id }, null, 2)}\n`);
    }
  } else {
    console.log('No hay valoraciones nuevas.');
  }
}
