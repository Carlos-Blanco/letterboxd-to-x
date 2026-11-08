import { run as hardcover } from './hardcover.js';
import { run as letterboxd } from './letterboxd.js';
import { run as psn } from './psn.js';

// Cada fuente por separado: que falle una no impide publicar lo de las demás.
for (const [name, run] of Object.entries({ Letterboxd: letterboxd, Hardcover: hardcover, PlayStation: psn })) {
  try {
    await run();
  } catch (error) {
    // Un fallo esperable (clave de Buffer inválida, servicio caído) no necesita volcar la pila,
    // pero sí la causa: un error de red en fetch solo dice «fetch failed».
    const cause = error.cause?.code ?? error.cause?.message;
    console.error(`${name}: ${cause ? `${error.message} (${cause})` : error.message}`);
    // PlayStation usa un token que caduca periódicamente. Si falla, se reporta en el log pero
    // no se marca código de salida 1 para evitar recibir correos de error cada 15 minutos.
    if (name !== 'PlayStation') {
      process.exitCode = 1;
    }
  }
}
