# Letterboxd to X

Publica en X las nuevas valoraciones de películas (RSS de Letterboxd) y de libros (RSS de Goodreads) cada 15 minutos. El post incluye el título, la valoración con estrellas, el texto de la reseña si existe y la portada.

Publica a través de la API del plan gratuito de [Buffer](https://buffer.com), que envía cada post a la cuenta de X conectada.

Si la reseña no cabe en los 280 caracteres de X, se recorta por palabras. Si Buffer rechaza la portada, el post se publica igualmente solo con texto para que la cola no se quede atascada. Las dos fuentes son independientes: si falla el RSS de una, lo de la otra se publica igual.

## Letterboxd

El post lleva el título y el año: `🍿 'The Odyssey' (2026)`. Para añadir el enlace al perfil, define `LETTERBOXD_PROFILE_URL` en el workflow.

Solo se publican las entradas del diario que llevan valoración: el RSS también incluye las listas del perfil (`letterboxd-list-*`) y las películas vistas sin puntuar, y esas se ignoran. El bot recuerda en `last-posted.json` la última entrada publicada y publica las que el RSS muestra por encima de ella.

## Goodreads

El post lleva el título y el autor: `📚 He leído 'Holly', de Stephen King`. Del título se quitan la saga y la edición que añade Goodreads («(Holly Gibney, #3)», «(Spanish Edition)»).

Define `GOODREADS_RSS_URL` en el workflow con el RSS de tu estantería de leídos: `https://www.goodreads.com/review/list_rss/<id>?shelf=read`, donde `<id>` es el número de la dirección de tu perfil. El perfil tiene que ser público. Sin esa variable, Goodreads no se consulta.

- Se publica un libro cuando recibe valoración. Los leídos sin puntuar se ignoran hasta entonces.
- El bot guarda en `goodreads-posted.json` todas las valoraciones ya vistas, y no solo la última: el RSS se ordena por «fecha de añadido», que cambia al editar una reseña antigua y la devuelve arriba. Cambiar la nota o la reseña de un libro ya visto no lo vuelve a publicar.
- Si aparecen más de 5 valoraciones nuevas a la vez, se registran sin publicarlas y la ejecución falla una vez para avisar: es una importación en bloque, no libros recién terminados.
- La portada es la de Goodreads. Si el libro no tiene, el post sale solo con texto.

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

En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez: si `last-posted.json` o `goodreads-posted.json` no existen, esa primera ejecución registra como punto de partida lo que ya hay en cada RSS, sin publicarlo. Las valoraciones nuevas se publicarán en ejecuciones posteriores.

El RSS configurado es `https://letterboxd.com/charlie_white/rss/`; se puede cambiar con `LETTERBOXD_RSS_URL`.

## Ejecución cada 15 minutos

El `schedule` del workflow queda solo como respaldo: GitHub retrasa o descarta muchas ejecuciones programadas, a veces durante horas. Lo que asegura la frecuencia es [cron-job.org](https://cron-job.org), que lanza el workflow cada 15 minutos por la API de GitHub. Las ejecuciones lanzadas así no se desactivan tras 60 días sin actividad en el repositorio, como les pasa a las programadas.

1. Crea un [fine-grained token](https://github.com/settings/personal-access-tokens/new) con acceso solo a este repositorio y el permiso **Actions: Read and write**.
2. En cron-job.org crea un cronjob con:
   - URL: `https://api.github.com/repos/Carlos-Blanco/letterboxd-to-x/actions/workflows/letterboxd.yml/dispatches`
   - Horario: cada 15 minutos
   - Método: `POST`, con el cuerpo `{"ref":"main"}`
   - Cabeceras: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` y `X-GitHub-Api-Version: 2022-11-28`

GitHub responde `204` cuando acepta la petición. Si coinciden dos ejecuciones, la segunda espera a que termine la primera y parte de la posición que esta acaba de guardar.

## Ejecución local

Requiere Node.js 20 o superior. Exporta `BUFFER_API_KEY` (y `GOODREADS_RSS_URL` y `TMDB_API_READ_ACCESS_TOKEN` si quieres) y ejecuta `npm start`. Publica de verdad y actualiza `last-posted.json` y `goodreads-posted.json`.
