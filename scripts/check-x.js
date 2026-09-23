// Diagnostica las credenciales de X sin publicar nada: sube una imagen de 1x1 px
// con cada método disponible y dice cuál sirve para la portada. La media queda
// suelta (no adjunta a ningún post) y X la descarta sola en 24 h.
//
//   X_USER_ACCESS_TOKEN=... npm run check-x          # solo OAuth 2.0
//   X_OAUTH1_CONSUMER_KEY=... (x4) npm run check-x   # solo OAuth 1.0a
//   ...ambos a la vez para compararlos
import { MEDIA_UPLOAD_ENDPOINT, hasOauth1, oauth1Header } from '../src/x.js';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function form() {
  const data = new FormData();
  data.append('media', new Blob([PIXEL], { type: 'image/png' }), 'pixel.png');
  data.append('media_category', 'tweet_image');
  return data;
}

async function probeUpload(label, authorization) {
  const response = await fetch(MEDIA_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: authorization },
    body: form(),
  });
  const body = await response.text();
  if (response.ok) {
    console.log(`✅ ${label}: sube portadas. media_id ${JSON.parse(body).data?.id}`);
    return true;
  }
  console.log(`❌ ${label}: falla (${response.status})`);
  console.log(`   ${body.replace(/\n\s*/g, ' ').slice(0, 300)}`);
  return false;
}

const accessToken = process.env.X_USER_ACCESS_TOKEN;
// El bot usa OAuth 1.0a en cuanto están los cuatro secretos, así que el
// veredicto depende solo del método que va a usar.
const usesOauth1 = hasOauth1();
let oauth1Works = false;
let oauth2Works = false;

if (accessToken) {
  const me = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await me.text();
  if (me.ok) console.log(`✅ OAuth 2.0: token válido, cuenta @${JSON.parse(body).data.username}`);
  else console.log(`❌ OAuth 2.0: el token no sirve (${me.status}). Si es 401 ha caducado; duran 2 h.\n   ${body.replace(/\n\s*/g, ' ').slice(0, 300)}`);
  oauth2Works = await probeUpload('OAuth 2.0 + media.write', `Bearer ${accessToken}`);
} else {
  console.log('➖ OAuth 2.0: sin X_USER_ACCESS_TOKEN, no lo pruebo.');
}

if (usesOauth1) {
  oauth1Works = await probeUpload('OAuth 1.0a', oauth1Header('POST', MEDIA_UPLOAD_ENDPOINT));
} else {
  console.log('➖ OAuth 1.0a: faltan los cuatro secretos X_OAUTH1_*, no lo pruebo.');
}

const botWorks = usesOauth1 ? oauth1Works : oauth2Works;
if (usesOauth1) {
  console.log(botWorks
    ? '\nEl bot usa OAuth 1.0a (están los cuatro X_OAUTH1_*) y puede subir la portada.'
    : '\nEl bot usa OAuth 1.0a porque están los cuatro X_OAUTH1_*, y falla: tampoco podrá publicar. OAuth 2.0 no se usa mientras existan.');
} else {
  console.log(botWorks
    ? '\nSin X_OAUTH1_*, el bot usa OAuth 2.0 y este token sube la portada.'
    : '\nEl método que usará el bot no puede subir la portada; los posts saldrían solo con texto.');
}
process.exitCode = botWorks ? 0 : 1;
