# Diario

Diario personal cifrado. Es una app web instalable (PWA) que funciona en iPhone, Mac, Windows, Linux y Android. Tiene calendario, fotos, desbloqueo con Face ID / Touch ID / Windows Hello y copia cifrada en Google Drive.

No necesita servidor propio ni compilación: son archivos estáticos.

## Cómo protege tu diario

- **Contraseña maestra → Argon2id** (64 MiB de memoria, 3 pasadas). De ahí sale la llave que abre tu diario. Adivinar contraseñas por fuerza bruta resulta muy lento y caro.
- **Todo se cifra con AES-256-GCM** en tu dispositivo: textos, fechas, ánimo y fotos. Cada archivo va atado a su nombre, así que no se pueden mezclar ni alterar sin que se note.
- **Google Drive solo recibe archivos ilegibles.** Van a la carpeta oculta de la app (`appDataFolder`), que no aparece en tu Drive ni la pueden ver otras apps. Google puede ver cuántos archivos hay, de qué tamaño y cuándo cambian, pero nunca su contenido.
- **Fotos sin metadatos:** se re-codifican antes de cifrarlas, lo que elimina la ubicación GPS y los datos EXIF.
- **Face ID / Touch ID / Windows Hello** usan una passkey con la extensión PRF. La passkey entrega un secreto solo después de la biometría, y con ese secreto se abre la llave del diario. Ni la contraseña ni la llave quedan guardadas en el dispositivo.
- **Bloqueo automático** tras 5 minutos sin uso (configurable) o 30 segundos después de salir de la app. Al bloquear, la página se recarga y la llave se borra de la memoria.
- **Sin scripts de terceros** y con una política CSP estricta. La única librería (Argon2, `hash-wasm`) va incluida en `js/vendor/`.

### Limitaciones que conviene saber

- **Si olvidas la contraseña maestra, el diario no se puede recuperar.** No existe "olvidé mi contraseña".
- **El código del iPhone como alternativa a Face ID:** si Face ID falla, iOS puede ofrecer el código del iPhone para usar la passkey. Lo mismo pasa en Mac (contraseña de usuario) y en Windows (PIN). Una app web no puede impedirlo, así que usa un código de iPhone largo. Si no quieres esto, deja la biometría desactivada y usa solo la contraseña maestra.
- **Linux:** los navegadores casi no usan el lector de huellas del sistema. Ahí se usa la contraseña maestra (o una llave física tipo YubiKey con PRF).
- **Requisitos para la biometría:** iOS 18 / macOS 15 (Safari 18) o Chrome/Edge recientes.
- **Una app web es tan confiable como el sitio que la sirve.** Si alguien controlara tu repositorio de GitHub, podría cambiar el código. Protege tu cuenta de GitHub con 2FA.

## Publicarla (GitHub Pages, gratis)

1. Crea un repositorio en GitHub (puede ser privado si tienes GitHub Pro; si no, público, que no es problema porque el código no contiene datos tuyos).
2. Sube el contenido de esta carpeta.
3. En el repositorio: **Settings → Pages → Branch: `main` / root → Save**.
4. Tu app quedará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

Para probarla en tu computadora: `python3 -m http.server 8770` dentro de esta carpeta y abre `http://localhost:8770`.

## Conectar Google Drive (una sola vez, ~10 minutos)

1. Entra a <https://console.cloud.google.com/> y crea un proyecto (por ejemplo "Diario").
2. **APIs y servicios → Biblioteca →** busca **Google Drive API** → Habilitar.
3. **APIs y servicios → Pantalla de consentimiento de OAuth:**
   - Tipo de usuario: **Externo**.
   - Nombre de la app: "Diario"; correo de soporte: el tuyo.
   - Permisos: agrega `.../auth/drive.appdata`.
   - **Usuarios de prueba:** agrega tu propio correo de Gmail.
   - Puedes dejarla en modo "Prueba": solo tú la vas a usar.
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth:**
   - Tipo: **Aplicación web**.
   - Orígenes autorizados de JavaScript: `https://TU-USUARIO.github.io` (y `http://localhost:8770` si quieres probar en local).
   - URI de redirección autorizados: `https://TU-USUARIO.github.io/NOMBRE-REPO/`, con la barra final (y `http://localhost:8770/` para local).
5. Copia el **ID de cliente** y pégalo en `js/config.js`:
   ```js
   export const GOOGLE_CLIENT_ID = '1234-abc.apps.googleusercontent.com';
   ```
6. Sube el cambio a GitHub.

El ID de cliente no es secreto: identifica la app, pero sin tu cuenta de Google no da acceso a nada.

## Instalarla

- **iPhone:** abre la URL en Safari → botón Compartir → **Agregar a pantalla de inicio**.
- **Mac:** en Safari → menú Archivo → **Agregar al Dock**. También sirve Chrome con el ícono "Instalar" en la barra de direcciones.
- **Windows / Linux:** en Chrome o Edge, ícono **Instalar** en la barra de direcciones.

## Primer uso en cada dispositivo

- **Primer dispositivo:** crea el diario con tu contraseña maestra. En Ajustes activa Face ID / Touch ID y conecta Google Drive.
- **Otros dispositivos:** en la pantalla inicial toca **"Ya tengo un diario en Google Drive"**, entra con tu Google y escribe tu contraseña maestra. Luego activa la biometría de ese dispositivo en Ajustes.

El permiso de Google dura una hora. Al abrir la app se renueva sola, con un salto rápido a Google. Si en algún momento ves el ícono de la nube en rojo, tócalo para reconectar.

## Archivos

```
index.html              página y política de seguridad (CSP)
css/app.css             diseño (claro y oscuro)
js/app.js               pantallas, calendario, editor, sincronización
js/crypto.js            cifrado (AES-256-GCM, Argon2id, HKDF)
js/bio.js               Face ID / Touch ID / Windows Hello (WebAuthn PRF)
js/drive.js             Google Drive (OAuth + API)
js/db.js                almacenamiento local cifrado (IndexedDB)
js/config.js            tu Client ID de Google
js/vendor/              Argon2 (hash-wasm 4.12.0, MIT)
sw.js                   funcionamiento sin conexión
```
