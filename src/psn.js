// Trofeos de platino: API de trofeos de PlayStation Network. Sony no ofrece
// una API pública, así que se usa la de su app móvil, igual que psn-api o PSNAWP.
import { appendFile } from 'node:fs/promises';
import { publishUnseen } from './post.js';

// Token de la sesión web de PlayStation, que se consulta en SSO_URL.
const NPSSO = process.env.PSN_NPSSO;
const SSO_URL = 'https://ca.account.sony.com/api/v1/ssocookie';
const STATE_FILE = new URL('../psn-posted.json', import.meta.url);
const AUTH_URL = 'https://ca.account.sony.com/api/authz/v3/oauth';
const TITLES_URL = 'https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles';
// Credenciales de la app de PlayStation para Android. Son públicas: las
// comparten todas las herramientas de la comunidad.
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_AUTH = 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';

// Deja en la salida del paso los días que le quedan al NPSSO, para que el
// workflow avise antes de que caduque. Es informativo: si falla, no impide
// consultar los trofeos.
async function reportDaysLeft() {
  try {
    const response = await fetch(SSO_URL, { headers: { Cookie: `npsso=${NPSSO}` } });
    const { expires_in: expiresIn } = await response.json();
    if (!Number.isFinite(expiresIn)) throw new Error(`respuesta ${response.status}`);
    const daysLeft = Math.floor(expiresIn / 86400);
    console.log(`PlayStation: al NPSSO le quedan ${daysLeft} días.`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `npsso_days_left=${daysLeft}\n`);
  } catch (error) {
    console.warn(`PlayStation: no se pudo consultar cuánto le queda al NPSSO (${error.message}).`);
  }
}

async function accessToken() {
  const query = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'psn:mobile.v2.core psn:clientapp',
  });
  // Con una sesión válida Sony redirige a REDIRECT_URI con el código; sin
  // ella, a su página de inicio de sesión.
  const authorize = await fetch(`${AUTH_URL}/authorize?${query}`, {
    headers: { Cookie: `npsso=${NPSSO}` },
    redirect: 'manual',
  });
  const location = authorize.headers.get('location') ?? '';
  const code = location.includes('?code=') && new URLSearchParams(location.split('?')[1]).get('code');
  if (!code) {
    throw new Error(`PlayStation no acepta PSN_NPSSO: caduca a los dos meses y deja de valer si inicias sesión de nuevo en la web. Genera otro en ${SSO_URL} y actualiza el secreto`);
  }

  const response = await fetch(`${AUTH_URL}/token`, {
    method: 'POST',
    headers: { Authorization: CLIENT_AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', token_format: 'jwt' }),
  });
  const tokens = await response.json();
  if (!tokens.access_token) {
    throw new Error(`PlayStation no devolvió el token de acceso (${response.status}): ${tokens.error_description ?? 'respuesta inesperada'}`);
  }
  return tokens.access_token;
}

// Los juegos con el platino ganado, el más reciente primero.
async function platinumTitles() {
  const token = await accessToken();
  const titles = [];
  for (let offset = 0; offset !== undefined;) {
    const response = await fetch(`${TITLES_URL}?limit=800&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`No se pudo leer la lista de trofeos (${response.status})`);
    const page = await response.json();
    titles.push(...page.trophyTitles);
    offset = page.nextOffset > offset ? page.nextOffset : undefined;
  }
  // Una lista vacía registraría un punto de partida sin platinos, y la
  // siguiente ejecución publicaría los antiguos como nuevos.
  if (!titles.length) throw new Error('PlayStation devolvió una lista de juegos vacía');

  return titles.filter((title) => title.earnedTrophies.platinum > 0).map((title) => ({
    id: title.npCommunicationId,
    title: title.trophyTitleName.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim(),
    image: title.trophyTitleIconUrl,
  }));
}

export async function run() {
  if (!NPSSO) {
    console.log('PlayStation: sin PSN_NPSSO, no se consulta.');
    return;
  }

  await reportDaysLeft();
  await publishUnseen({
    name: 'PlayStation',
    stateFile: STATE_FILE,
    seed: async () => (await platinumTitles()).map((game) => game.id),
    latest: platinumTitles,
    toPost: (game) => ({
      title: game.title,
      text: `🏆 He conseguido el platino de '${game.title}'`,
      imageUrl: game.image,
    }),
  });
}
