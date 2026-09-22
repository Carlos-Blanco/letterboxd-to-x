# Letterboxd to X

Publica en X las nuevas valoraciones de Letterboxd, incluyendo el título, las estrellas y la portada cuando el RSS la ofrece. GitHub Actions consulta el feed cada 15 minutos.

## Configuración

1. Añade estos **repository secrets** en `Settings → Secrets and variables → Actions`:
   - `X_CLIENT_ID` y `X_CLIENT_SECRET`: credenciales OAuth 2.0 de la app.
   - `X_REFRESH_TOKEN`: refresh token de usuario OAuth 2.0 obtenido con los permisos `tweet.write`, `tweet.read`, `users.read`, `media.write` y `offline.access`.
   - `GH_SECRETS_TOKEN`: fine-grained personal access token con permiso **Secrets: write** para este repositorio. Actions lo usa para guardar el refresh token nuevo cuando X lo rota.
2. La subida de portadas usa `POST /2/media/upload` y publicar usa `POST /2/tweets`, ambos autenticados con el access token OAuth 2.0 renovado al inicio de cada ejecución.
3. En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado.
4. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez. Esa primera ejecución guarda la entrada más reciente como punto de partida sin publicarla. Las valoraciones posteriores se publicarán automáticamente.

El feed configurado es `https://letterboxd.com/charlie_white/rss/`. Se puede cambiar con la variable `LETTERBOXD_RSS_URL`.

## Ejecución local

Requiere Node.js 20 o superior y las mismas credenciales OAuth 2.0. Ejecuta `npm start`.
