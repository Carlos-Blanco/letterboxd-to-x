// Comprueba la conexión con Buffer sin publicar nada: valida BUFFER_API_KEY,
// lista los canales conectados y dice en cuál publicará el bot.
//
//   BUFFER_API_KEY=... npm run check-buffer
import { listChannels, xChannel } from '../src/buffer.js';

try {
  const channels = await listChannels();
  console.log('✅ BUFFER_API_KEY válida. Canales conectados:');
  for (const channel of channels) console.log(`   ${channel.service.padEnd(10)} ${channel.name}  (${channel.id})`);

  const configured = process.env.BUFFER_CHANNEL_ID;
  const target = configured ? channels.find((channel) => channel.id === configured) : xChannel(channels);
  if (!target) throw new Error(`BUFFER_CHANNEL_ID (${configured}) no corresponde a ningún canal de esta cuenta.`);
  console.log(`\nEl bot publicará en ${target.service} · ${target.name}${configured ? ' (BUFFER_CHANNEL_ID)' : ''}.`);
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
