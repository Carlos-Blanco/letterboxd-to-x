import { run as goodreads } from './goodreads.js';
import { run as letterboxd } from './letterboxd.js';

// Cada fuente por separado: que falle un RSS no impide publicar lo de la otra.
for (const [name, run] of Object.entries({ Letterboxd: letterboxd, Goodreads: goodreads })) {
  try {
    await run();
  } catch (error) {
    // Un fallo esperable (clave de Buffer inválida, RSS caído) no necesita volcar la pila,
    // pero sí la causa: un error de red en fetch solo dice «fetch failed».
    const cause = error.cause?.code ?? error.cause?.message;
    console.error(`${name}: ${cause ? `${error.message} (${cause})` : error.message}`);
    process.exitCode = 1;
  }
}
