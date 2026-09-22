# Letterboxd to X

Publica en X las nuevas valoraciones del RSS de Letterboxd cada 15 minutos. El post incluye el título y año, la valoración con estrellas, el texto de la reseña si existe, un enlace al perfil y la portada.

## Secretos de GitHub Actions

En `Settings → Secrets and variables → Actions` configura:

- `X_OAUTH1_CONSUMER_KEY`
- `X_OAUTH1_CONSUMER_SECRET`
- `X_OAUTH1_ACCESS_TOKEN`
- `X_OAUTH1_ACCESS_TOKEN_SECRET`
- `TMDB_API_READ_ACCESS_TOKEN` (opcional; si falta o TMDB no encuentra una coincidencia exacta, usa la imagen del RSS)

Los cuatro secretos `X_OAUTH1_*` son las credenciales OAuth 1.0a de usuario con permisos Read and Write. Se usan para subir la portada mediante `media/upload`. La consola OAuth 2.0 de esta app no ofrece `media.write`; por eso usamos OAuth 1.0a para esa operación. La publicación se hace mediante `POST /2/tweets` con OAuth 2.0.

Para renovar el token de publicación añade también `X_REFRESH_TOKEN`, `X_CLIENT_ID`, `X_CLIENT_SECRET` y `GH_SECRETS_TOKEN`. El OAuth 2.0 debe incluir `offline.access`; el fine-grained PAT `GH_SECRETS_TOKEN` debe limitarse a este repositorio con permiso **Secrets: write**, para guardar un refresh token rotado. OAuth 1.0a no usa refresh token: si regeneras esas credenciales en X, actualiza los cuatro secretos `X_OAUTH1_*`.

TMDB busca el título y el año y solo se usa cuando la coincidencia es exacta. La API gratuita de TMDB es para uso no comercial y requiere atribución. Incluye el aviso “This product uses the TMDB API but is not endorsed or certified by TMDB” y su logo conforme a [sus requisitos](https://developer.themoviedb.org/docs/faq).

En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez: esa primera ejecución registra la entrada actual como punto de partida sin publicarla. Las valoraciones nuevas se publicarán en ejecuciones posteriores. La cuenta de X debe tener créditos/API access disponibles; X responde `402 credits depleted` si se agota el saldo y no se publica el post.

El RSS configurado es `https://letterboxd.com/charlie_white/rss/`; se puede cambiar con `LETTERBOXD_RSS_URL`. El perfil se configura con `LETTERBOXD_PROFILE_URL`.

## Ejecución local

Requiere Node.js 20 o superior. Exporta los secretos `X_OAUTH1_*` y ejecuta `npm start`.
