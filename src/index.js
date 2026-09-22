import { readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';

const FEED_URL = process.env.LETTERBOXD_RSS_URL ?? 'https://letterboxd.com/charlie_white/rss/';
const LETTERBOXD_PROFILE_URL = process.env.LETTERBOXD_PROFILE_URL ?? 'https://letterboxd.com/charlie_white/';
const TMDB_API_READ_ACCESS_TOKEN = process.env.TMDB_API_READ_ACCESS_TOKEN;
const STATE_FILE = new URL('../last-posted.json', import.meta.url);

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
    const ratingValue = Number(tag(item, 'letterboxd:memberRating'));
    const ratingText = tag(item, 'letterboxd:memberRating')
      ? '⭐'.repeat(Math.floor(ratingValue)) + (ratingValue % 1 >= 0.5 ? '½' : '')
      : (feedTitle.match(/(★+½?|½)/)?.[0] ?? '').replaceAll('★', '⭐');
    return { id, title: filmTitle, year, rating: ratingText, review, link, image };
  }).filter((entry) => entry.id && entry.title);
}

function oauth1Header(method, rawUrl, bodyParams = {}) {
  const consumerKey = process.env.X_OAUTH1_CONSUMER_KEY;
  const consumerSecret = process.env.X_OAUTH1_CONSUMER_SECRET;
  const token = process.env.X_OAUTH1_ACCESS_TOKEN;
  const tokenSecret = process.env.X_OAUTH1_ACCESS_TOKEN_SECRET;
  if (![consumerKey, consumerSecret, token, tokenSecret].every(Boolean)) {
    throw new Error('Configura los cuatro secretos X_OAUTH1_* para subir imágenes y publicar.');
  }

  const url = new URL(rawUrl);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const parameters = [
    ...url.searchParams.entries(),
    ...Object.entries(bodyParams),
    ...Object.entries(oauth),
  ].map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(String(value))])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`).join('&');
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const baseString = [method.toUpperCase(), encodeURIComponent(baseUrl), encodeURIComponent(parameters)].join('&');
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', signingKey).update(baseString).digest('base64');
  return `OAuth ${Object.entries(oauth).map(([key, value]) => `${encodeURIComponent(key)}="${encodeURIComponent(value)}"`).join(', ')}`;
}

function normalizeTitle(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

async function tmdbPosterUrl(entry) {
  if (!TMDB_API_READ_ACCESS_TOKEN) return entry.image;

  try {
    const params = new URLSearchParams({ query: entry.title, language: 'en-US' });
    if (entry.year) params.set('primary_release_year', entry.year);
    const response = await fetch(`https://api.themoviedb.org/3/search/movie?${params}`, {
      headers: {
        Authorization: `Bearer ${TMDB_API_READ_ACCESS_TOKEN}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      console.warn(`TMDB no respondió (${response.status}); usaré la imagen del RSS si existe.`);
      return entry.image;
    }

    const { results = [] } = await response.json();
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

async function uploadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar la portada (${response.status})`);
  const image = Buffer.from(await response.arrayBuffer());
  const form = new FormData();
  form.append('media', new Blob([image], { type: response.headers.get('content-type') ?? 'image/jpeg' }), 'poster.jpg');
  const endpoint = 'https://upload.twitter.com/1.1/media/upload.json?media_category=tweet_image';
  const upload = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: oauth1Header('POST', endpoint) },
    body: form,
  });
  if (!upload.ok) {
    const detail = await upload.text();
    throw new Error(`X rechazó la portada (${upload.status}): ${detail}`);
  }
  const result = await upload.json();
  const id = result.media_id_string ?? result.media_id;
  if (!id) throw new Error(`X no devolvió el identificador de la portada: ${JSON.stringify(result)}`);
  return id;
}

async function publish(entry) {
  const posterUrl = await tmdbPosterUrl(entry);
  const mediaId = posterUrl ? await uploadImage(posterUrl) : undefined;
  const details = [entry.rating, entry.review].filter(Boolean).join('\n');
  const text = [`🍿 Acabo de ver '${entry.title}'${entry.year ? ` (${entry.year})` : ''}`, details]
    .filter(Boolean).join('\n') + `\n\n${LETTERBOXD_PROFILE_URL}`;
  const body = { status: text, ...(mediaId ? { media_ids: mediaId } : {}) };
  const endpoint = 'https://api.x.com/1.1/statuses/update.json';
  const encodedBody = new URLSearchParams(body);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: oauth1Header('POST', endpoint, body),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodedBody,
  });
  if (!response.ok) throw new Error(`X rechazó la publicación (${response.status}): ${await response.text()}`);
  console.log(`Publicado: ${text}`);
}

async function readState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

const response = await fetch(FEED_URL, { headers: { 'User-Agent': 'letterboxd-to-x/1.0' } });
if (!response.ok) throw new Error(`No se pudo leer el RSS (${response.status})`);
const entries = parseFeed(await response.text());
if (!entries.length) throw new Error('El RSS no contiene entradas reconocibles');

const state = await readState();
if (!state.lastPostedId) {
  await writeFile(STATE_FILE, `${JSON.stringify({ lastPostedId: entries[0].id }, null, 2)}\n`);
  console.log(`Punto de partida guardado: ${entries[0].title}. Las nuevas valoraciones se publicarán en las siguientes ejecuciones.`);
} else {
  const lastIndex = entries.findIndex((entry) => entry.id === state.lastPostedId);
  const pending = lastIndex === -1 ? [entries[0]] : entries.slice(0, lastIndex).reverse();
  if (pending.length) {
    for (const entry of pending) {
      await publish(entry);
      await writeFile(STATE_FILE, `${JSON.stringify({ lastPostedId: entry.id }, null, 2)}\n`);
    }
  } else {
    console.log('No hay valoraciones nuevas.');
  }
}
