// Cliente de la API GraphQL de Buffer. Buffer publica en X con su propio acceso
// a la API, así que no hay que pagar la de X ni firmar peticiones OAuth. Vive
// aparte de index.js para que el script de diagnóstico pruebe el mismo código.
const ENDPOINT = 'https://api.buffer.com';

async function graphql(query, variables = {}) {
  const apiKey = process.env.BUFFER_API_KEY;
  if (!apiKey) throw new Error('Configura BUFFER_API_KEY (se genera en https://publish.buffer.com/settings/api).');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.text();
  let payload = {};
  try { payload = JSON.parse(body); } catch { /* el mensaje de error usará el cuerpo tal cual */ }
  // GraphQL suele responder 200 aunque falle: el error viaja en `errors`.
  const errors = payload.errors?.map((error) => error.message).join('; ');
  if (!response.ok || errors) throw new Error(`Buffer respondió ${response.status}: ${errors || body}`);
  return payload.data;
}

export async function listChannels() {
  const { account } = await graphql('query Organizations { account { organizations { id name } } }');
  const channels = [];
  for (const organization of account.organizations) {
    const data = await graphql(
      'query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }',
      { input: { organizationId: organization.id } },
    );
    channels.push(...data.channels);
  }
  return channels;
}

export function xChannel(channels) {
  const candidates = channels.filter((channel) => channel.service === 'twitter');
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new Error('No hay ninguna cuenta de X conectada en Buffer: conéctala en https://publish.buffer.com.');
  const list = candidates.map((channel) => `${channel.name}: ${channel.id}`).join(', ');
  throw new Error(`Hay ${candidates.length} cuentas de X en Buffer (${list}); elige una con BUFFER_CHANNEL_ID.`);
}

export async function resolveChannelId() {
  return process.env.BUFFER_CHANNEL_ID || xChannel(await listChannels()).id;
}

const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

// Con shareNow Buffer envía el post a X en el momento, sin pasar por la cola
// (que en el plan gratuito admite solo 10 posts programados por canal). La
// imagen va como URL pública: Buffer la descarga y la adjunta él mismo.
// Devuelve { post } o, si Buffer lo rechaza, { rejection } con el motivo.
export async function sharePost(channelId, text, imageUrl) {
  const input = {
    channelId,
    text,
    schedulingType: 'automatic',
    mode: 'shareNow',
    assets: imageUrl ? [{ image: { url: imageUrl } }] : [],
  };
  const { createPost } = await graphql(CREATE_POST, { input });
  if (createPost?.post) return { post: createPost.post };
  return { rejection: createPost?.message ?? JSON.stringify(createPost) };
}
