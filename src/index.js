import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const FEED_URL = process.env.LETTERBOXD_RSS_URL ?? 'https://letterboxd.com/charlie_white/rss/';
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

function parseFeed(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const feedTitle = tag(item, 'title').replace(/<[^>]+>/g, '').trim();
    const link = tag(item, 'link');
    const id = tag(item, 'guid') || link;
    const description = tag(item, 'description');
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
    return { id, title: filmTitle, year, rating: ratingText, link, image };
  }).filter((entry) => entry.id && entry.title);
}

async function accessToken() {
  const refreshToken = process.env.X_REFRESH_TOKEN;
  if (refreshToken) {
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Para renovar OAuth 2.0 hacen falta X_CLIENT_ID y X_CLIENT_SECRET');
    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!response.ok) throw new Error(`No se pudo renovar el token OAuth 2.0 (${response.status}): ${await response.text()}`);
    const tokens = await response.json();
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      const ghToken = process.env.GH_SECRETS_TOKEN;
      const repository = process.env.GITHUB_REPOSITORY;
      if (!ghToken || !repository) throw new Error('X rotó el refresh token; configura GH_SECRETS_TOKEN para guardar el nuevo token en GitHub');
      execFileSync('gh', ['secret', 'set', 'X_REFRESH_TOKEN', '--repo', repository], {
        input: tokens.refresh_token,
        env: { ...process.env, GH_TOKEN: ghToken },
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      console.log('Refresh token renovado y guardado en GitHub Secrets.');
    }
    return tokens.access_token;
  }

  const token = process.env.X_USER_ACCESS_TOKEN;
  if (!token) throw new Error('Configura X_REFRESH_TOKEN (recomendado) o X_USER_ACCESS_TOKEN');
  return token;
}

async function uploadImage(url, token) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar la portada (${response.status})`);
  const image = Buffer.from(await response.arrayBuffer());
  const form = new FormData();
  form.append('media', new Blob([image], { type: response.headers.get('content-type') ?? 'image/jpeg' }), 'poster.jpg');
  form.append('media_category', 'tweet_image');
  const endpoint = 'https://api.x.com/2/media/upload';
  const upload = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!upload.ok) throw new Error(`X rechazó la portada (${upload.status}): ${await upload.text()}`);
  const result = await upload.json();
  const id = result.data?.id ?? result.data?.media_id;
  if (!id) throw new Error(`X no devolvió el identificador de la portada: ${JSON.stringify(result)}`);
  return id;
}

async function publish(entry, token) {
  const mediaId = entry.image ? await uploadImage(entry.image, token) : undefined;
  const text = `🍿 Acabo de ver '${entry.title}'${entry.year ? ` (${entry.year})` : ''}${entry.rating ? `\n${entry.rating}` : ''}`;
  const body = { text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) };
  const endpoint = 'https://api.x.com/2/tweets';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
    const token = await accessToken();
    for (const entry of pending) {
      await publish(entry, token);
      await writeFile(STATE_FILE, `${JSON.stringify({ lastPostedId: entry.id }, null, 2)}\n`);
    }
  } else {
    console.log('No hay valoraciones nuevas.');
  }
}
