# Letterboxd to X

Publica en X las nuevas valoraciones del RSS de Letterboxd cada 15 minutos. El post incluye el título y año, la valoración con estrellas, el texto de la reseña si existe, un enlace al perfil y la portada.

Solo se publican las entradas del diario que llevan valoración: el RSS también incluye las listas del perfil (`letterboxd-list-*`) y las películas vistas sin puntuar, y esas se ignoran. Si la reseña no cabe en los 280 caracteres de X, se recorta por palabras. Si la portada falla, el post se publica igualmente solo con texto para que la cola no se quede atascada.

## Secretos de GitHub Actions

En `Settings → Secrets and variables → Actions` configura:

- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `X_REFRESH_TOKEN`
- `X_OAUTH1_CONSUMER_KEY`
- `X_OAUTH1_CONSUMER_SECRET`
- `X_OAUTH1_ACCESS_TOKEN`
- `X_OAUTH1_ACCESS_TOKEN_SECRET`
- `GH_SECRETS_TOKEN` (para guardar el refresh token cuando X lo rota)
- `TMDB_API_READ_ACCESS_TOKEN` (opcional; si falta o TMDB no encuentra una coincidencia exacta, usa la imagen del RSS)

## Autenticación con X

La publicación (`POST /2/tweets`) usa **OAuth 2.0 de usuario**. La portada va a `POST https://api.x.com/2/media/upload`, que acepta dos métodos: OAuth 2.0 con el scope `media.write`, u **OAuth 1.0a de usuario**. El endpoint antiguo `https://upload.twitter.com/1.1/media/upload.json` fue retirado en junio de 2025 y ya no sirve.

El generador de tokens de la consola (`Keys & Tokens` → *Token de acceso* → **Generar**) **no ofrece `media.write`** en su lista de alcances. Por eso el bot sube la portada con OAuth 1.0a: lo intenta primero y solo recurre a OAuth 2.0 si esas credenciales faltan o fallan. El orden importa porque en un proyecto de pago por uso cada petición rechazada cuesta créditos.

Con eso basta y no hace falta `media.write`. Configura:

- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` → publicar. Genera el refresh token en la consola marcando `tweet.write` y *Incluir token de actualización* (`offline.access`).
- Los cuatro `X_OAUTH1_*` (Consumer Key/Secret y Access Token/Secret, con permiso **Leer y escribir**) → subir la portada.
- `GH_SECRETS_TOKEN`: fine-grained PAT limitado a este repositorio con permiso **Secrets: write**, para guardar el refresh token cuando X lo rota.

Comprueba las credenciales sin publicar nada:

```sh
X_USER_ACCESS_TOKEN=... X_OAUTH1_CONSUMER_KEY=... X_OAUTH1_CONSUMER_SECRET=... \
X_OAUTH1_ACCESS_TOKEN=... X_OAUTH1_ACCESS_TOKEN_SECRET=... npm run check-x
```

Sube una imagen de 1×1 px con cada método y dice cuál sirve. La media queda suelta, sin adjuntar a ningún post, y X la descarta en 24 h.

### Opcional: OAuth 2.0 con media.write

Si prefieres prescindir de OAuth 1.0a, el scope `media.write` existe (está en el spec oficial de X) aunque la consola no lo liste: hay que pedirlo en la URL de autorización, que exige PKCE. Registra `http://localhost:8723/callback` como Callback URI de la app y ejecuta:

```sh
X_CLIENT_ID=... X_CLIENT_SECRET=... npm run authorize
```

Imprime la URL completa, recoge el código en el callback local, lo canjea y muestra los scopes concedidos y el refresh token. El refresh token conserva los scopes con los que se creó, así que para añadir `media.write` hay que generar uno nuevo; refrescar el antiguo no lo añade.

TMDB se consulta por el `tmdb:movieId` que ya trae el RSS de Letterboxd, así que la portada corresponde siempre a la película exacta; si esa ficha no tiene póster se busca por título y año aceptando solo coincidencias exactas, y en último término se usa la imagen del RSS. La API gratuita de TMDB es para uso no comercial y requiere atribución. Incluye el aviso “This product uses the TMDB API but is not endorsed or certified by TMDB” y su logo conforme a [sus requisitos](https://developer.themoviedb.org/docs/faq).

Si X responde `402 credits depleted`, el proyecto se ha quedado sin saldo: se recarga en `Facturación → Créditos`. La valoración no se pierde, queda en cola para la siguiente ejecución.

En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez: esa primera ejecución registra la entrada actual como punto de partida sin publicarla. Las valoraciones nuevas se publicarán en ejecuciones posteriores. La cuenta de X debe tener créditos/API access disponibles; X responde `402 credits depleted` si se agota el saldo y no se publica el post.

El RSS configurado es `https://letterboxd.com/charlie_white/rss/`; se puede cambiar con `LETTERBOXD_RSS_URL`. El perfil se configura con `LETTERBOXD_PROFILE_URL`.

## Ejecución local

Requiere Node.js 20 o superior. Exporta los secretos de arriba (o directamente `X_USER_ACCESS_TOKEN` en vez del refresh) y ejecuta `npm start`.
