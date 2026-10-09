// Ajuste del texto al límite de X y publicación, común a todas las fuentes.
import { resolveChannelId, sharePost } from './buffer.js';
import { readState, writeState } from './feed.js';

// X cuenta 280 «unidades»: cada URL pesa 23 pase lo que pase y los caracteres
// fuera de los rangos latinos básicos (emojis y estrellas incluidos) pesan 2.
const POST_LIMIT = 280;
const URL_PATTERN = /https?:\/\/\S+/gi;
// Tantas entradas nuevas a la vez no son cosas recién terminadas, sino una
// importación en bloque o un cambio en la fuente: publicarlas inundaría la cuenta.
const MAX_NEW_ENTRIES = 5;

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

// `compose(review)` devuelve el post completo con esa reseña.
export function fitText(compose, review) {
  const full = compose(review);
  if (postLength(full) <= POST_LIMIT) return full;

  // Recortamos la reseña palabra a palabra hasta que el post entra en el límite;
  // si ni siquiera cabe sin reseña, cortamos el texto entero por caracteres.
  let kept = '';
  for (const word of review.split(/\s+/)) {
    const candidate = kept ? `${kept} ${word}` : word;
    if (postLength(compose(`${candidate}…`)) > POST_LIMIT) break;
    kept = candidate;
  }
  const trimmed = compose(kept ? `${kept}…` : '');
  if (postLength(trimmed) <= POST_LIMIT) return trimmed;

  const characters = [...trimmed];
  while (characters.length && postLength(characters.join('')) > POST_LIMIT) characters.pop();
  return characters.join('');
}

let channelId;

export async function publish({ title, text, imageUrl }) {
  // Se resuelve al publicar por primera vez: las ejecuciones sin novedades no
  // gastan peticiones de Buffer.
  channelId ??= await resolveChannelId();
  if (!imageUrl) console.warn(`Sin portada disponible para «${title}»; publico solo el texto.`);

  let result = await sharePost(channelId, text, imageUrl);
  let withCover = Boolean(imageUrl);
  if (result.rejection && imageUrl) {
    // Publicamos igualmente sin portada: si no, la entrada se queda atascada y
    // el workflow reintenta la misma valoración cada 15 minutos sin publicar nada.
    console.warn(`Buffer rechazó el post de «${title}» con portada (${result.rejection}); lo intento solo con el texto.`);
    result = await sharePost(channelId, text);
    withCover = false;
  }
  if (result.rejection) throw new Error(`Buffer rechazó el post de «${title}»: ${result.rejection}`);
  console.log(`Enviado a X vía Buffer${withCover ? ' con portada' : ' sin portada'} (post ${result.post.id}): ${text}`);
}

// Para fuentes cuyo orden no es de fiar: guarda en `stateFile` todos los ids ya
// vistos y publica las entradas que no estén entre ellos.
// - `seed()` devuelve todos los ids que existen; solo se llama la primera vez.
// - `latest()` devuelve las entradas recientes, la más nueva primero.
// - `toPost(entry)` devuelve lo que recibe `publish`.
export async function publishUnseen({ name, stateFile, seed, latest, toPost }) {
  const state = await readState(stateFile);
  if (!state.seenIds) {
    const seenIds = await seed();
    await writeState(stateFile, { seenIds });
    console.log(`${name}: punto de partida guardado con ${seenIds.length} entradas que ya existían. Las nuevas se publicarán en las siguientes ejecuciones.`);
    return;
  }

  const seen = new Set(state.seenIds);
  const pending = (await latest()).filter((entry) => !seen.has(entry.id)).reverse();
  if (!pending.length) console.log(`${name}: no hay novedades.`);

  if (pending.length > MAX_NEW_ENTRIES) {
    await writeState(stateFile, { seenIds: [...state.seenIds, ...pending.map((entry) => entry.id)] });
    throw new Error(`${pending.length} entradas nuevas a la vez: las registro sin publicarlas (el máximo por ejecución es ${MAX_NEW_ENTRIES})`);
  }

  const seenIds = [...state.seenIds];
  for (const entry of pending) {
    await publish(toPost(entry));
    seenIds.push(entry.id);
    await writeState(stateFile, { seenIds });
  }
}
