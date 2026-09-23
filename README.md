# Letterboxd to X

Publica en X las nuevas valoraciones del RSS de Letterboxd cada 15 minutos. El post incluye el título y año, la valoración con estrellas, el texto de la reseña si existe y la portada. Para añadir el enlace al perfil, define `LETTERBOXD_PROFILE_URL` en el workflow.

Publica a través de [Buffer](https://buffer.com), cuyo plan gratuito incluye API. Así no hace falta la API de X, que desde febrero de 2026 es solo de pago por uso, ni gestionar sus credenciales OAuth.

Solo se publican las entradas del diario que llevan valoración: el RSS también incluye las listas del perfil (`letterboxd-list-*`) y las películas vistas sin puntuar, y esas se ignoran. Si la reseña no cabe en los 280 caracteres de X, se recorta por palabras. Si Buffer rechaza la portada, el post se publica igualmente solo con texto para que la cola no se quede atascada.

## Configurar Buffer

1. Crea una cuenta gratuita en [buffer.com](https://buffer.com) y conecta tu cuenta de X como canal.
2. Genera una API key en [publish.buffer.com/settings/api](https://publish.buffer.com/settings/api).
3. Comprueba la conexión sin publicar nada:

   ```sh
   BUFFER_API_KEY=... npm run check-buffer
   ```

   Lista los canales conectados y dice en cuál publicará el bot.

El bot crea cada post con `mode: shareNow`, así que sale al momento sin pasar por la cola de Buffer (que en el plan gratuito admite 10 posts programados por canal). La portada se pasa como URL pública y es Buffer quien la descarga y la adjunta.

## Secretos de GitHub Actions

En `Settings → Secrets and variables → Actions` configura:

- `BUFFER_API_KEY`
- `BUFFER_CHANNEL_ID` (opcional; sin él se usa la única cuenta de X conectada en Buffer. Solo hace falta si tienes varias: `npm run check-buffer` muestra sus IDs)
- `TMDB_API_READ_ACCESS_TOKEN` (opcional; si falta o TMDB no encuentra una coincidencia exacta, usa la imagen del RSS)

## Portadas

TMDB se consulta por el `tmdb:movieId` que ya trae el RSS de Letterboxd, así que la portada corresponde siempre a la película exacta; si esa ficha no tiene póster se busca por título y año aceptando solo coincidencias exactas, y en último término se usa la imagen del RSS. La API gratuita de TMDB es para uso no comercial y requiere atribución. Incluye el aviso “This product uses the TMDB API but is not endorsed or certified by TMDB” y su logo conforme a [sus requisitos](https://developer.themoviedb.org/docs/faq).

## Límites

El plan gratuito de Buffer incluye [una API key y 3.000 peticiones al mes](https://support.buffer.com/article/859-does-buffer-have-an-api). Cada valoración publicada gasta tres (una si defines `BUFFER_CHANNEL_ID`), y las ejecuciones sin valoraciones nuevas no llaman a Buffer. X admite hasta 50 posts al día desde una cuenta sin verificar.

El bot solo sabe si Buffer ha aceptado el post. Si X lo rechaza después (por ejemplo, por contenido duplicado), el fallo aparece en el panel de Buffer, no en el log del workflow.

## Puesta en marcha

En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez: si `last-posted.json` no existe, esa primera ejecución registra la entrada actual como punto de partida sin publicarla. Las valoraciones nuevas se publicarán en ejecuciones posteriores.

El RSS configurado es `https://letterboxd.com/charlie_white/rss/`; se puede cambiar con `LETTERBOXD_RSS_URL`.

## Ejecución local

Requiere Node.js 20 o superior. Exporta `BUFFER_API_KEY` (y `TMDB_API_READ_ACCESS_TOKEN` si quieres) y ejecuta `npm start`. Publica de verdad y actualiza `last-posted.json`.
