# Letterboxd to X

Publica en X las nuevas valoraciones del RSS de Letterboxd cada 15 minutos. El post incluye el título y año, la valoración con estrellas, el texto de la reseña si existe y la portada. El enlace al perfil es opcional (ver [Coste](#coste)).

Solo se publican las entradas del diario que llevan valoración: el RSS también incluye las listas del perfil (`letterboxd-list-*`) y las películas vistas sin puntuar, y esas se ignoran. Si la reseña no cabe en los 280 caracteres de X, se recorta por palabras. Si la portada falla, el post se publica igualmente solo con texto para que la cola no se quede atascada.

## Secretos de GitHub Actions

En `Settings → Secrets and variables → Actions` configura:

- `X_OAUTH1_CONSUMER_KEY`
- `X_OAUTH1_CONSUMER_SECRET`
- `X_OAUTH1_ACCESS_TOKEN`
- `X_OAUTH1_ACCESS_TOKEN_SECRET`
- `TMDB_API_READ_ACCESS_TOKEN` (opcional; si falta o TMDB no encuentra una coincidencia exacta, usa la imagen del RSS)

Solo si prescindes de OAuth 1.0a (ver abajo): `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` y `GH_SECRETS_TOKEN`.

## Autenticación con X

El bot publica (`POST /2/tweets`) y sube la portada (`POST https://api.x.com/2/media/upload`) con **OAuth 1.0a de usuario**: Consumer Key/Secret de la app y Access Token/Secret de tu cuenta, generados con permiso **Leer y escribir**. Estos tokens no caducan; solo dejan de valer si se regeneran o se revoca la app. Si cambias los permisos de la app, regenera el Access Token/Secret, porque conservan el permiso con el que se crearon.

El endpoint antiguo `https://upload.twitter.com/1.1/media/upload.json` fue retirado oficialmente en junio de 2025; no hay que depender de él.

### Alternativa: OAuth 2.0

Si faltan los secretos `X_OAUTH1_*`, el bot publica con OAuth 2.0 renovando `X_REFRESH_TOKEN` cada vez que hay algo que publicar. Para usarla, añade al `env` del workflow `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` y `GH_SECRETS_TOKEN`. X invalida el refresh token al canjearlo y devuelve otro, que el bot guarda en GitHub Secrets con `GH_SECRETS_TOKEN` (fine-grained PAT limitado a este repositorio con permiso **Secrets: Read and write**). Si falta `GH_SECRETS_TOKEN`, el bot no renueva el token para no perderlo.

Una autorización nueva de la misma cuenta con la misma app puede invalidar el refresh token guardado: el generador de la consola, `npm run authorize` o una ejecución local con ese token. Después de guardarlo, no generes otro.

En modo OAuth 2.0 la portada se sube con ese mismo token, que necesita el scope `media.write`; sin él los posts salen solo con texto. El generador de tokens de la consola (`Keys & Tokens` → *Token de acceso* → **Generar**) **no ofrece `media.write`**, pero el scope existe (está en el spec oficial de X): hay que pedirlo en la URL de autorización, que exige PKCE. Registra `http://localhost:8723/callback` como Callback URI de la app y ejecuta:

```sh
X_CLIENT_ID=... X_CLIENT_SECRET=... npm run authorize
```

Imprime la URL completa, recoge el código en el callback local, lo canjea y muestra los scopes concedidos y el refresh token. El refresh token conserva los scopes con los que se creó, así que para añadir `media.write` hay que generar uno nuevo; refrescar el antiguo no lo añade.

### Diagnóstico

Comprueba las credenciales sin publicar nada:

```sh
X_OAUTH1_CONSUMER_KEY=... X_OAUTH1_CONSUMER_SECRET=... \
X_OAUTH1_ACCESS_TOKEN=... X_OAUTH1_ACCESS_TOKEN_SECRET=... npm run check-x
```

Sube una imagen de 1×1 px con cada método disponible y dice si el que usará el bot funciona. Añade `X_USER_ACCESS_TOKEN` para probar también OAuth 2.0; es solo informativo, porque el bot no usa OAuth 2.0 mientras estén los cuatro `X_OAUTH1_*`. La media queda suelta, sin adjuntar a ningún post, y X la descarta en 24 h. Cada subida de prueba cuesta $0,015.

## Portadas

TMDB se consulta por el `tmdb:movieId` que ya trae el RSS de Letterboxd, así que la portada corresponde siempre a la película exacta; si esa ficha no tiene póster se busca por título y año aceptando solo coincidencias exactas, y en último término se usa la imagen del RSS. La API gratuita de TMDB es para uso no comercial y requiere atribución. Incluye el aviso “This product uses the TMDB API but is not endorsed or certified by TMDB” y su logo conforme a [sus requisitos](https://developer.themoviedb.org/docs/faq).

## Coste

La API de X no tiene nivel gratuito: desde el 6 de febrero de 2026 es de pago por uso. Se compran créditos por adelantado en la consola y cada petición los descuenta; según X, [los reintentos fallidos también pueden contar](https://devcommunity.x.com/t/274646). Tarifas vigentes desde el 20 de abril de 2026 ([precios](https://docs.x.com/x-api/getting-started/pricing)):

| Operación | Coste |
| --- | --- |
| Publicar un post | $0,015 |
| Publicar un post **cuyo texto contiene una URL** | $0,200 |
| Subir una imagen (X la cuenta como publicar un post) | $0,015 |

El bot sube la portada antes de publicar, así que cada valoración cuesta unos $0,030. Por eso publica sin enlace al perfil: con él costaría unos $0,215, unas 7 veces más. Si quieres incluirlo, define `LETTERBOXD_PROFILE_URL` en el workflow; el bot lo avisa en el log.

Si X responde `402 credits depleted`, el proyecto se ha quedado sin saldo: se recarga en `Facturación → Créditos`. La valoración no se pierde, queda en cola para la siguiente ejecución.

## Puesta en marcha

En `Settings → Actions → General`, permite que GitHub Actions lea y escriba en el repositorio para guardar el último elemento procesado. Activa Actions y ejecuta manualmente **Letterboxd to X** una vez: esa primera ejecución registra la entrada actual como punto de partida sin publicarla. Las valoraciones nuevas se publicarán en ejecuciones posteriores.

El RSS configurado es `https://letterboxd.com/charlie_white/rss/`; se puede cambiar con `LETTERBOXD_RSS_URL`.

## Ejecución local

Requiere Node.js 20 o superior. Exporta los cuatro secretos `X_OAUTH1_*` (y `TMDB_API_READ_ACCESS_TOKEN` si quieres) y ejecuta `npm start`. Publica de verdad y actualiza `last-posted.json`. No uses en local el `X_REFRESH_TOKEN` del workflow: renovarlo lo invalida para GitHub Actions.
