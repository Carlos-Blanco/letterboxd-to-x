# Letterboxd to X

Publica en X las nuevas valoraciones de Letterboxd, incluyendo el título, las estrellas y la portada cuando el RSS la ofrece. GitHub Actions consulta el feed cada 15 minutos.

## Configuración

1. Añade el repository secret `X_USER_ACCESS_TOKEN` en `Settings → Secrets and variables → Actions`. Debe ser un token de usuario OAuth 2.0 con permisos `tweet.write`, `tweet.read`, `users.read` y `media.write`.
2. La subida de portadas usa `POST /2/media/upload` y publicar usa `POST /2/tweets`, ambos autenticados con el Bearer token de usuario.
3. En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado.
4. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez. Esa primera ejecución guarda la entrada más reciente como punto de partida sin publicarla. Las valoraciones posteriores se publicarán automáticamente mientras el access token siga vigente.

El feed configurado es `https://letterboxd.com/charlie_white/rss/`. Se puede cambiar con la variable `LETTERBOXD_RSS_URL`.

## Ejecución local

El workflow actual usa un access token estático, que caduca. Para renovar automáticamente, configura también `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` y `GH_SECRETS_TOKEN` (fine-grained PAT con permiso **Secrets: write**); el workflow debe exponer estos secrets al proceso para activar esa ruta.

Requiere Node.js 20 o superior y `X_USER_ACCESS_TOKEN`. Ejecuta `npm start`.
