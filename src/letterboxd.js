// Valoraciones de películas: RSS del perfil de Letterboxd, con la portada de TMDB.
import { fetchItems, htmlToText, readState, tag, writeState } from './feed.js';
import { fitText, publish } from './post.js';

const FEED_URL = process.env.LETTERBOXD_RSS_URL ?? 'https://letterboxd.com/charlie_white/rss/';
const LETTERBOXD_PROFILE_URL = process.env.LETTERBOXD_PROFILE_URL ?? '';
const TMDB_API_READ_ACCESS_TOKEN = process.env.TMDB_API_READ_ACCESS_TOKEN;
const STATE_FILE = new URL('../last-posted.json', import.meta.url);

function parseItems(items) {
  return items.map((item) => {
    const feedTitle = tag(item, 'title').replace(/<[^>]+>/g, '').trim();
    const id = tag(item, 'guid') || tag(item, 'link');
    const description = tag(item, 'description');
    const review = htmlToText(description.replace(/<p>\s*Watched on\b[\s\S]*?<\/p>/gi, ' '));
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
    return { id, title: filmTitle, year, rating: ratingText, review, image, tmdbId: tag(item, 'tmdb:movieId') };
  }).filter((entry) => entry.id && entry.title && entry.rating);
  // El RSS mezcla las entradas del diario con las listas del perfil
  // (`letterboxd-list-*`), que no llevan `memberRating`: exigir una valoración
  // deja fuera las listas y las películas vistas pero aún sin puntuar.
}

function normalizeTitle(value = '') {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
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

function composeText(entry, review) {
  const header = `🍿 '${entry.title}'${entry.year ? ` (${entry.year})` : ''}`;
  const details = [entry.rating, review].filter(Boolean).join('\n');
  const cuerpo = [header, details].filter(Boolean).join('\n');
  return LETTERBOXD_PROFILE_URL ? `${cuerpo}\n\n${LETTERBOXD_PROFILE_URL}` : cuerpo;
}

export async function run() {
  const entries = parseItems(await fetchItems(FEED_URL));
  if (!entries.length) throw new Error('El RSS no contiene valoraciones reconocibles');

  const state = await readState(STATE_FILE);
  if (!state.lastPostedId) {
    await writeState(STATE_FILE, { lastPostedId: entries[0].id });
    console.log(`Letterboxd: punto de partida guardado en ${entries[0].title}. Las nuevas valoraciones se publicarán en las siguientes ejecuciones.`);
    return;
  }

  const lastIndex = entries.findIndex((entry) => entry.id === state.lastPostedId);
  const pending = lastIndex === -1 ? [entries[0]] : entries.slice(0, lastIndex).reverse();
  if (!pending.length) console.log('Letterboxd: no hay valoraciones nuevas.');
  for (const entry of pending) {
    await publish({
      title: entry.title,
      text: fitText((review) => composeText(entry, review), entry.review),
      imageUrl: await tmdbPosterUrl(entry),
    });
    await writeState(STATE_FILE, { lastPostedId: entry.id });
  }
}
