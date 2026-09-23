// Cliente de la API de X: firma OAuth 1.0a, renovación de OAuth 2.0 y subida de
// media. Vive aparte de index.js para que los scripts de diagnóstico puedan
// probar exactamente el mismo código que usa el bot.
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';

export const MEDIA_UPLOAD_ENDPOINT = 'https://api.x.com/2/media/upload';

// OAuth 1.0a exige percent-encoding RFC 3986, y encodeURIComponent deja sin
// escapar !'()* — basta con que uno de esos caracteres aparezca en un parámetro
// o en un secreto para que la firma no cuadre y X responda «code 32».
const rfc3986 = (value) => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export function hasOauth1() {
  return ['X_OAUTH1_CONSUMER_KEY', 'X_OAUTH1_CONSUMER_SECRET', 'X_OAUTH1_ACCESS_TOKEN', 'X_OAUTH1_ACCESS_TOKEN_SECRET']
    .every((name) => process.env[name]);
}

// `fixed` solo lo usan los tests, para reproducir el vector de prueba oficial
// de Twitter con un nonce y un timestamp conocidos.
export function oauth1Header(method, rawUrl, bodyParams = {}, fixed = {}) {
  const consumerKey = process.env.X_OAUTH1_CONSUMER_KEY;
  const consumerSecret = process.env.X_OAUTH1_CONSUMER_SECRET;
  const token = process.env.X_OAUTH1_ACCESS_TOKEN;
  const tokenSecret = process.env.X_OAUTH1_ACCESS_TOKEN_SECRET;
  if (!hasOauth1()) {
    throw new Error('Configura los cuatro secretos X_OAUTH1_* para firmar la petición.');
  }

  const url = new URL(rawUrl);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: fixed.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0',
  };
  // En multipart/form-data los campos del cuerpo no entran en la firma; solo
  // los de la query y los propios oauth_*.
  const parameters = [
    ...url.searchParams.entries(),
    ...Object.entries(bodyParams),
    ...Object.entries(oauth),
  ].map(([key, value]) => [rfc3986(key), rfc3986(String(value))])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`).join('&');
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const baseString = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(parameters)].join('&');
  const signingKey = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', signingKey).update(baseString).digest('base64');
  return `OAuth ${Object.entries(oauth).map(([key, value]) => `${rfc3986(key)}="${rfc3986(value)}"`).join(', ')}`;
}

export async function oauth2AccessToken() {
  const refreshToken = process.env.X_REFRESH_TOKEN;
  if (!refreshToken) {
    const token = process.env.X_USER_ACCESS_TOKEN;
    if (!token) throw new Error('Configura X_REFRESH_TOKEN o X_USER_ACCESS_TOKEN para publicar.');
    return token;
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Para renovar OAuth 2.0 hacen falta X_CLIENT_ID y X_CLIENT_SECRET.');
  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!response.ok) throw new Error(`No se pudo renovar OAuth 2.0 (${response.status}): ${await response.text()}`);
  const tokens = await response.json();

  if (tokens.scope && !tokens.scope.split(/\s+/).includes('media.write')) {
    console.warn(`El token OAuth 2.0 no incluye media.write (tiene: ${tokens.scope}); la portada se subirá con OAuth 1.0a.`);
  }

  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    const ghToken = process.env.GH_SECRETS_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    if (!ghToken || !repository) throw new Error('X rotó el refresh token; configura GH_SECRETS_TOKEN para guardar el nuevo en GitHub.');
    execFileSync('gh', ['secret', 'set', 'X_REFRESH_TOKEN', '--repo', repository], {
      input: tokens.refresh_token,
      env: { ...process.env, GH_TOKEN: ghToken },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    console.log('Refresh token OAuth 2.0 renovado y guardado en GitHub Secrets.');
  }
  return tokens.access_token;
}

// El esquema oficial de /2/media/upload declara additionalProperties:false y
// solo acepta media, media_category y additional_owners.
function mediaForm(bytes, contentType) {
  const form = new FormData();
  form.append('media', new Blob([bytes], { type: contentType }), `media.${contentType.split('/')[1] || 'jpg'}`);
  form.append('media_category', 'tweet_image');
  return form;
}

// `upload.twitter.com/1.1/media/upload.json` quedó retirado en junio de 2025; el
// único endpoint vigente es el v2, que acepta OAuth 2.0 de usuario (con scope
// media.write) y OAuth 1.0a de usuario.
export async function uploadMedia(bytes, contentType, accessToken) {
  // OAuth 1.0a va primero: el generador de tokens de la consola de X no ofrece
  // el scope media.write, así que el intento con OAuth 2.0 casi siempre falla, y
  // en un proyecto de pago por uso cada petición desperdiciada cuesta dinero.
  const attempts = [];
  if (hasOauth1()) attempts.push(['OAuth 1.0a', () => oauth1Header('POST', MEDIA_UPLOAD_ENDPOINT)]);
  if (accessToken) attempts.push(['OAuth 2.0', () => `Bearer ${accessToken}`]);
  if (!attempts.length) throw new Error('No hay credenciales para subir media.');

  let last;
  for (const [label, authorization] of attempts) {
    const upload = await fetch(MEDIA_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: authorization() },
      body: mediaForm(bytes, contentType),
    });
    if (upload.ok) {
      const result = await upload.json();
      const id = result.data?.id ?? result.media_id_string;
      if (!id) throw new Error(`X no devolvió el identificador de la media: ${JSON.stringify(result)}`);
      return { id, via: label };
    }
    last = `${label} → ${upload.status}: ${await upload.text()}`;
    if (![401, 403].includes(upload.status)) break;
    if (attempts.length > 1) console.warn(`X rechazó la subida con ${last}`);
  }
  throw new Error(`X rechazó la media (${last})`);
}

export async function uploadImageFromUrl(url, accessToken) {
  // X no puede adjuntar una URL remota: hay que descargar los bytes y subirlos.
  const response = await fetch(url, { headers: { 'User-Agent': 'letterboxd-to-x/1.0' } });
  if (!response.ok) throw new Error(`No se pudo descargar la portada (${response.status})`);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`La URL de la portada no devolvió una imagen (${contentType || 'tipo desconocido'})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('La portada descargada está vacía');
  return uploadMedia(bytes, contentType, accessToken);
}
