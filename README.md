# Letterboxd to X

Publica en X las nuevas valoraciones de Letterboxd, incluyendo un texto como `🍿 Acabo de ver 'Star Wars' (1977)`, las estrellas (`⭐⭐⭐⭐½`), el texto de la reseña si existe, un enlace al perfil separado por una línea en blanco y la portada. GitHub Actions consulta el feed cada 15 minutos.

## Configuración

1. Añade el repository secret `X_USER_ACCESS_TOKEN` en `Settings → Secrets and variables → Actions`. Debe ser un token de usuario OAuth 2.0 autorizado con `tweet.read`, `tweet.write`, `users.read` y `media.write`. X documenta `media.write` como el permiso para subir imágenes; un token generado sin ese alcance no puede adjuntar portadas.
2. Para usar TMDB como fuente de pósteres, añade también `TMDB_API_READ_ACCESS_TOKEN` (API Read Access Token de TMDB) como repository secret. El flujo busca el título y año y usa solo una coincidencia exacta; si no encuentra una, recurre a la imagen del RSS.
3. Para renovar automáticamente los tokens OAuth 2.0, añade `X_REFRESH_TOKEN`, `X_CLIENT_ID` y `X_CLIENT_SECRET`. El token debe haberse autorizado con `offline.access` y `media.write` además de los scopes de publicación/usuario.
4. X puede rotar el refresh token al renovarlo. Para que el workflow guarde el nuevo valor, añade `GH_SECRETS_TOKEN`: un fine-grained personal access token limitado a este repo con permiso **Secrets: write**.
5. La subida de portadas usa `POST /2/media/upload` y publicar usa `POST /2/tweets`, ambos autenticados con el Bearer token de usuario. El workflow comprueba primero `GET /2/users/me` para distinguir un token inválido de un rechazo específico de subida de medios.
6. En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado.
7. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez. Esa primera ejecución guarda la entrada más reciente como punto de partida sin publicarla. Las valoraciones posteriores se publicarán automáticamente mientras el refresh token siga vigente.

TMDB indica que su API gratuita es para uso no comercial y requiere atribución. Incluye en el proyecto o su sección de créditos el aviso “This product uses the TMDB API but is not endorsed or certified by TMDB” y su logo conforme a sus requisitos: https://developer.themoviedb.org/docs/faq.

El feed configurado es `https://letterboxd.com/charlie_white/rss/`. Se puede cambiar con la variable `LETTERBOXD_RSS_URL`.

## Ejecución local

El workflow actual usa un access token estático, que caduca. Para renovar automáticamente, configura también `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` y `GH_SECRETS_TOKEN` (fine-grained PAT con permiso **Secrets: write**); el workflow debe exponer estos secrets al proceso para activar esa ruta.

Requiere Node.js 20 o superior y `X_USER_ACCESS_TOKEN`. Ejecuta `npm start`.
