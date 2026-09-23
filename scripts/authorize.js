// Genera un refresh token OAuth 2.0 de X con los scopes que necesita el bot,
// media.write incluido. Los scopes NO se configuran en el portal de X: viajan
// en la URL de autorización, y X exige PKCE, así que hay que construirla aquí.
//
//   X_CLIENT_ID=... X_CLIENT_SECRET=... node scripts/authorize.js
//
// Antes, en el portal (Developer Portal -> tu app -> User authentication settings):
//   - App permissions: Read and write
//   - Type of App: Web App, Automated App or Bot  (cliente confidencial)
//   - Callback URI: exactamente la misma que REDIRECT_URI (abajo)

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI ?? 'http://localhost:8723/callback';
const SCOPES = process.env.SCOPES ?? 'tweet.read tweet.write users.read media.write offline.access';

if (!CLIENT_ID) {
  console.error('Falta X_CLIENT_ID. Úsalo así:\n  X_CLIENT_ID=... X_CLIENT_SECRET=... node scripts/authorize.js');
  process.exit(1);
}

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const codeVerifier = base64url(randomBytes(32));
const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
const state = base64url(randomBytes(16));

const authorizeUrl = `https://x.com/i/oauth2/authorize?${new URLSearchParams({
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  scope: SCOPES,
  state,
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
  // URLSearchParams codifica el espacio como '+'; la documentación de X usa
  // '%20' y no todos los servidores OAuth tratan '+' como separador de scopes.
}).toString().replace(/\+/g, '%20')}`;

const callback = new URL(REDIRECT_URI);

async function exchange(code) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  };
  // Cliente confidencial (Web App / Automated App): credenciales por cabecera
  // Basic. Cliente público (Native App): client_id en el cuerpo.
  if (CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
  } else {
    body.client_id = CLIENT_ID;
  }

  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: new URLSearchParams(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`X rechazó el intercambio (${response.status}): ${text}`);
  return JSON.parse(text);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, REDIRECT_URI);
  if (url.pathname !== callback.pathname) {
    response.writeHead(404).end('No es la ruta de callback');
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (error || !code) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end(`X devolvió un error: ${error ?? 'sin código'}`);
    console.error(`\nX devolvió un error: ${error ?? 'sin código'} — ${url.searchParams.get('error_description') ?? ''}`);
    server.close();
    process.exitCode = 1;
    return;
  }
  if (url.searchParams.get('state') !== state) {
    response.writeHead(400).end('state no coincide');
    console.error('\nEl parámetro state no coincide: aborto por seguridad.');
    server.close();
    process.exitCode = 1;
    return;
  }

  try {
    const tokens = await exchange(code);
    const granted = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Listo. Vuelve a la terminal.');

    console.log('\nScopes concedidos:', granted.join(' ') || '(ninguno)');
    for (const required of ['tweet.write', 'media.write', 'offline.access']) {
      if (!granted.includes(required)) console.warn(`  ⚠️  falta ${required}`);
    }
    if (!tokens.refresh_token) {
      console.warn('\nX no devolvió refresh_token: asegúrate de incluir offline.access en SCOPES.');
    } else {
      console.log('\nGuarda esto en el secreto X_REFRESH_TOKEN del repositorio:\n');
      console.log(tokens.refresh_token);
      console.log('\n  gh secret set X_REFRESH_TOKEN --repo <usuario>/letterboxd-to-x');
    }
  } catch (failure) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(failure.message);
    console.error(`\n${failure.message}`);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(Number(callback.port || 80), callback.hostname, () => {
  console.log(`Esperando el callback en ${REDIRECT_URI}`);
  console.log('(Debe estar registrada tal cual en Callback URI del portal de X.)');
  console.log('\nAbre esta URL en el navegador:\n');
  console.log(authorizeUrl);
  console.log();
});
