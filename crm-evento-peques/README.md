# 🎈 CRM Peques

CRM para el evento de los peques: cargás los contactos y sus teléfonos, y el sistema les escribe por WhatsApp
(bienvenida, recordatorios antes del evento, agradecimiento después) y registra sus respuestas.

- **Contactos**: alta manual o importación desde Excel / Google Sheets (CSV o pegando las celdas). Estados
  (nuevo → contactado → interesado → confirmado → asistió), etiquetas, nombre/edad de los peques, exportación a CSV.
- **Chats**: bandeja con todas las respuestas, unificada con el historial de envíos (✓ enviado, ✓✓ entregado, ✓✓ leído).
- **Campañas**: un mensaje a un grupo (por estado o etiqueta), ahora o programado, con contador de entregados/leídos.
- **Automatizaciones**: bienvenida, recordatorio 1 día y 2 horas antes, agradecimiento, y respuestas a palabras clave
  (`SI` confirma y cambia el estado solo, `NO`, `BAJA` da de baja). Todo editable.
- **WhatsApp Cloud API** (la API oficial de Meta). Sin credenciales corre en **modo simulación**, para probar todo.

**Tres formas de usarlo** (el código es el mismo, cambia dónde corre):

| | Costo | Para quién |
|---|---|---|
| **A. Nube gratis: Supabase + Netlify** (sección «Versión en la nube») | $0 | Lo más fácil: queda funcionando 24 h sin servidor propio. |
| **B. Servidor propio** (secciones 1 a 3, ej. Render) | ~USD 7/mes | Si preferís un solo servidor Node con su base SQLite. |
| **C. En tu compu** (`npm start` o `cd supabase && npm run dev`) | $0 | Para probarlo o desarrollarlo; sin WhatsApp real. |

---

## ☁️ Versión en la nube, gratis (Supabase + Netlify)

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Interfaz (lo que ve tu equipo) | **Netlify** (sitio estático) | Contactos, chats, campañas, ajustes |
| Base de datos + API + tareas programadas | **Supabase** (Postgres + Edge Function + `pg_cron`) | Guarda todo, habla con WhatsApp, y **cada minuto** envía lo pendiente y dispara los recordatorios |

La interfaz y la API están en dominios distintos, así que la sesión viaja como un **token firmado** (no como cookie).
Las tablas tienen la seguridad por filas (RLS) activada **sin políticas**: la API pública de Supabase no puede leer nada;
solo accede la función, con credenciales de servidor.

### Publicar la interfaz en Netlify (elegí una)

La dirección de la API ya viene configurada en `netlify.toml` (variable `CRM_API_URL`).

1. **Desde GitHub** (se actualiza sola con cada cambio): en Netlify → *Add new site → Import an existing project* →
   GitHub → este repositorio y su rama → *Deploy*. No hay que tocar nada: `netlify.toml` ya trae carpeta, comando y versión.
2. **Arrastrando una carpeta** (sin GitHub): corré
   `cd crm-evento-peques && CRM_API_URL=https://TU-PROYECTO.supabase.co/functions/v1/api node scripts/build-netlify.mjs`
   y arrastrá la carpeta `dist/` a <https://app.netlify.com/drop>.

Después abrí la dirección que te da Netlify y entrá con la contraseña inicial (cambiala en **Ajustes → Tu cuenta**).

### Conectar WhatsApp en la versión en la nube

Seguí las secciones **2.1, 2.3, 2.4 y 2.5** más abajo, con estas diferencias:

- **No hace falta 2.2** (publicar con HTTPS): la función de Supabase ya es pública y con HTTPS.
- Las credenciales **no van en variables de entorno**: se cargan en **Ajustes → WhatsApp** (token, ID del número y App
  Secret). Quedan en tu base de Supabase y el panel nunca las vuelve a mostrar.
- En esa misma pantalla están la **URL del webhook** y el **token de verificación** para pegar en Meta, con botón de copiar.

### Límites del plan gratuito (según la documentación de cada servicio; verificá los vigentes)

- **Supabase**: 500 MB de base y 500.000 llamadas a funciones por mes (el cron usa ~43.000). Los proyectos gratuitos
  **se pausan si pasan una semana con poca actividad**; el cron genera consultas todo el tiempo y no debería pasar, pero
  si ocurriera se reactiva con un clic en el panel de Supabase (*Resume project*) y no se pierde nada.
- **Netlify**: el plan gratuito tiene un tope mensual de créditos; para un sitio estático interno sobra.
- Las respuestas y los envíos manuales salen al instante; los **recordatorios y reintentos salen dentro del minuto**
  siguiente a su hora (el cron corre cada 60 s).

### Instalarlo en OTRO proyecto de Supabase (técnico)

1. Creá el proyecto en <https://supabase.com> (región cercana, ej. São Paulo).
2. En el *SQL Editor* corré `supabase/migrations/20261005000000_crm_schema.sql`.
3. Fijá la contraseña inicial y la dirección de la función (cambiá los dos valores):
   ```sql
   insert into public.settings (key, value) values
     ('admin_hash', extensions.crypt('TU-CONTRASEÑA-LARGA', extensions.gen_salt('bf', 10))),
     ('api_url', 'https://TU-PROYECTO.supabase.co/functions/v1/api')
   on conflict (key) do update set value = excluded.value;
   ```
4. Desplegá la función **sin verificación JWT** (la API tiene su propia autenticación):
   `supabase functions deploy api --no-verify-jwt --project-ref TU-PROYECTO` (con el CLI de Supabase, desde la carpeta `supabase/`).
5. Corré `supabase/migrations/20261005000100_crm_cron.sql` (activa el cron de cada minuto).
6. Actualizá `CRM_API_URL` en `netlify.toml` con la dirección de la función y publicá la interfaz.

### Probarlo en tu compu sin cuentas

```bash
cd crm-evento-peques && CRM_API_URL=http://localhost:54321/functions/v1/api node scripts/build-netlify.mjs
cd ../supabase && npm install && npm run dev      # web en :5173, API en :54321, contraseña: dev-clave
```

Usa Postgres en memoria (PGlite) con el mismo esquema y la misma API que corre en Supabase.

---

## 1. Probarlo ahora (modo simulación)

Necesita Node.js 22.13 o superior (la base SQLite viene incluida en Node; no hay nada más que instalar).

```bash
cd crm-evento-peques
npm start
```

Abrí <http://localhost:3000>. La contraseña de entrada se muestra en la consola la primera vez
(queda guardada en `data/admin-password.txt`). Para elegir la tuya: `ADMIN_PASSWORD=mi-clave npm start`
o copiá `.env.example` a `.env`.

Recorrido sugerido (5 minutos):

1. **Ajustes** → cargá nombre, fecha, hora y lugar del evento.
2. **Contactos → Importar** → pegá filas de tu planilla (o subí el CSV). Se reconocen columnas como
   *Nombre, Celular, Hijo/a, Edad, Cantidad de niños, Email*. Revisá la vista previa y confirmá.
3. **Automatizaciones** → activá las que quieras (vienen apagadas para que primero revises los textos).
4. **Contactos → 💬** en una familia → en *Simular respuesta* escribí `SI`: vas a ver cómo pasa a *Confirmado* y
   recibe la confirmación con la fecha y el lugar.
5. **Campañas** → mandá un aviso a los *Confirmados*.

En simulación **nada sale a WhatsApp**, pero se aplican las mismas reglas (ventana de 24 h, bajas, plantillas).

---

## 2. Conectar tu WhatsApp real

> Necesitás una cuenta de **Meta Business** y un número de teléfono para el evento. El número que uses en la API
> **no puede estar activo en la app común de WhatsApp** (se migra a la API; conviene un número dedicado).
> Los pasos de Meta cambian de lugar de vez en cuando; la guía oficial vigente está en
> [WhatsApp Cloud API · Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started).

### 2.1 Crear la app y obtener los datos

1. Entrá a <https://developers.facebook.com> → **Crear app** → tipo **Business** → agregá el producto **WhatsApp**.
2. En **WhatsApp → API Setup** (o *Configuración de la API*) vas a ver el **Phone number ID** → es tu
   `WHATSAPP_PHONE_NUMBER_ID`. Meta te da un número de prueba para empezar; para producción agregá tu número real.
3. **Token permanente** (el temporal vence en horas): *Business Settings → System users → Add* → creá un usuario del
   sistema → *Assign assets*: tu app (**Manage app**) y tu cuenta de WhatsApp (**Manage WhatsApp Business accounts**,
   control total) → **Generate token** con los permisos `whatsapp_business_messaging` y
   `whatsapp_business_management`. Eso es `WHATSAPP_TOKEN`.
4. **App Secret**: *App settings → Basic → App secret*. Es `WHATSAPP_APP_SECRET`. Se usa para comprobar que los
   mensajes entrantes vienen realmente de Meta (firma `X-Hub-Signature-256`). **Sin esto el CRM rechaza las respuestas.**
5. Inventá un texto cualquiera como `WHATSAPP_VERIFY_TOKEN` (por ejemplo `peques-2026-clave-larga`).

### 2.2 Publicar el CRM con HTTPS (Render)

Meta solo acepta webhooks a una dirección pública con HTTPS (no sirve `localhost`). Hace falta un **servidor que
esté siempre encendido**, con un disco donde guardar la base de datos. Por eso **no sirve Netlify ni Vercel**: son
para páginas estáticas y funciones que se apagan después de cada llamada (sin disco ni procesos en segundo plano).

El repositorio trae un `render.yaml` en la raíz que deja todo configurado:

1. Creá una cuenta en <https://render.com> y conectá tu GitHub.
2. **New → Blueprint** → elegí este repositorio y la rama donde está la carpeta `crm-evento-peques`.
3. Render te pide una sola cosa: `ADMIN_PASSWORD` (la contraseña del equipo; ponela larga). → **Apply**.
4. Esperá unos minutos. Queda en una dirección tipo `https://crm-peques.onrender.com`, con un disco de 1 GB
   (`/var/data`) donde vive la base. Entrá con tu contraseña: arranca en **modo simulación**.
5. Cuando tengas los datos de Meta (sección 2.1): **crm-peques → Environment** y agregá `WHATSAPP_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_APP_SECRET`. El `WHATSAPP_VERIFY_TOKEN` ya viene generado: copialo de ahí
   para pegarlo en Meta (paso 2.3). Al guardar, el servicio se reinicia solo y el panel pasa a «Conectado».

Detalles a tener en cuenta:

- Usa el plan **Starter** (de pago): los discos persistentes no existen en el plan gratuito, y el gratuito además
  se duerme, lo que frenaría la cola de mensajes y el webhook. Verificá el precio vigente en Render.
- Cada deploy o reinicio cierra las sesiones (volvés a poner la contraseña) y corta el servicio unos segundos.
- Usá **una sola instancia** (SQLite no se comparte entre varias).
- Otros hostings con servidor y volumen persistente (Railway, Fly.io) sirven igual: mismas variables de
  `.env.example`, `DATA_DIR` apuntando al volumen y `COOKIE_SECURE=1`.
- Nunca subas tu `.env` ni los tokens al repositorio.

### 2.3 Registrar el webhook

*Meta → WhatsApp → Configuration → Webhook*:

- **Callback URL**: `https://TU-DOMINIO/webhook/whatsapp` (también la ves en **Ajustes** del CRM, con botón de copiar).
- **Verify token**: el `WHATSAPP_VERIFY_TOKEN` que elegiste.
- **Verify and save** y, en *Webhook fields*, suscribite a **`messages`**.

### 2.4 Crear las plantillas (imprescindible)

WhatsApp solo permite texto libre a quien **te escribió en las últimas 24 horas**. Para escribirle primero a una
familia (bienvenida, recordatorios, campañas) hay que usar **plantillas aprobadas por Meta**. Se crean en
*WhatsApp Manager → Message templates*, idioma **Español (Argentina)**, y la aprobación puede tardar hasta 24 h.

El CRM ya viene con estos nombres y variables; creá las plantillas **con el mismo nombre** y respetando el orden de
las variables (`{{1}}`, `{{2}}`…):

| Nombre | Texto sugerido | `{{1}}` `{{2}}` `{{3}}` `{{4}}` `{{5}}` |
|---|---|---|
| `bienvenida_evento` | ¡Hola {{1}}! 🎈 Gracias por tu interés en {{2}}. Será el {{3}} a las {{4}} en {{5}}. Respondé SI para reservar lugar, o BAJA si no querés recibir más mensajes. | nombre, evento, fecha, hora, lugar |
| `recordatorio_evento` | ¡Hola {{1}}! 🎉 Te recordamos que mañana es {{2}}. Hora: {{3}}. Lugar: {{4}}. ¡Los esperamos! | nombre, evento, hora, lugar |
| `recordatorio_hoy` | ¡Hola {{1}}! Hoy es el gran día 🎈 Los esperamos a las {{2}} en {{3}} ({{4}}). ¡Hasta pronto! | nombre, hora, lugar, direccion |
| `gracias_evento` | ¡Gracias por venir, {{1}}! 💛 Esperamos que los peques la hayan pasado genial en {{2}}. Contanos qué te pareció respondiendo este mensaje. | nombre, evento |

Reglas de Meta que conviene recordar: una variable no puede ir al principio ni al final del texto, ni dos juntas;
Meta decide la categoría final (*Marketing* o *Utility*) y, para promociones, exige que la persona haya aceptado
recibirlas. Si cambiás el nombre o las variables en el CRM (**Automatizaciones → Editar → Plantilla**), tienen que
coincidir con lo aprobado.

Las respuestas (`SI`, `NO`, `BAJA`) y los mensajes manuales desde **Chats** salen como texto libre, sin plantilla,
porque la familia acaba de escribirte y la ventana de 24 h está abierta.

### 2.5 Probar

**Ajustes → Probar**: envía la plantilla `hello_world` (viene en toda cuenta de Meta) al número que indiques. Con el
número de prueba de Meta, el destinatario tiene que estar en la lista de permitidos del panel de Meta.

Después, importá un contacto tuyo, activá **Bienvenida** y respondé `SI` desde tu celular.

### Límites y cuidados

- Las cuentas nuevas tienen un **tope diario de contactos nuevos** a los que podés escribirles, que sube con el uso
  y la buena calidad (mirá el valor actual en WhatsApp Manager). Si lo superás, esos envíos fallan y el CRM lo muestra.
- Escribí solo a quienes aceptaron. La importación pide confirmarlo, y `BAJA` deja de enviarle de inmediato.
  Un nivel alto de bloqueos o denuncias puede hacer que Meta limite o suspenda el número.
- No uses librerías no oficiales que “escanean el QR” de WhatsApp Web para automatizar envíos masivos: violan los
  términos de WhatsApp y suelen terminar en la suspensión del número. Este CRM usa solo la API oficial.
- Los peques son menores de edad: guardá solo lo necesario (nombre de pila y edad), restringí quién tiene la
  contraseña y tené en cuenta la normativa de protección de datos personales aplicable.

---

## 3. Referencia

### Variables de entorno

| Variable | Para qué |
|---|---|
| `ADMIN_PASSWORD` | Contraseña de entrada. Vacía = se genera una y se guarda en `data/admin-password.txt`. |
| `PORT`, `DATA_DIR` | Puerto (3000) y carpeta de la base de datos (`./data`). |
| `COOKIE_SECURE` | `1` si lo publicás con HTTPS. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Si están ambas, se activa la conexión real. Si no, simulación. |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Para recibir respuestas (webhook). |
| `WHATSAPP_API_VERSION` | Versión de la Graph API (por defecto `v25.0`). |
| `WHATSAPP_AR_DROP_9` | `1` si Meta rechaza celulares argentinos con el 9 (envía `54XXXXXXXXXX`). |
| `SEND_BATCH` | Mensajes por ciclo de 5 s (5 ≈ 60 por minuto). |

### Teléfonos

Se aceptan formatos como `223 456-7890`, `0223 15 456-7890`, `+54 9 223 456 7890`. Todo se guarda como
`549…` y los duplicados se detectan por los últimos 10 dígitos. Los números sin código de área reciben el
**código de área por defecto de Ajustes (223, Mar del Plata)**: cambialo si tu evento es en otra zona.

### Cómo decide el CRM qué enviar

Todo mensaje pasa por una **cola** (reintenta si Meta falla, respeta el ritmo y las bajas). Por cada destinatario:
si respondió en las últimas 24 h → texto libre; si no y hay plantilla → plantilla; si no → falla con un aviso claro.
Cada familia recibe cada automatización **una sola vez**. Los recordatorios usan la fecha del evento vigente al
momento de enviar; si el servidor estuvo apagado, salen hasta 6 h tarde y no después.

### Copias de seguridad

Copiá periódicamente `data/crm.sqlite` (con el servidor detenido) y/o usá **Contactos → Exportar** para bajar un CSV.

### Tests

```bash
npm test
```

34 pruebas: normalización de teléfonos, importación, cola y ventana de 24 h, automatizaciones, y una prueba de
integración HTTP contra un Meta simulado (firma del webhook, formato de los pedidos a la Cloud API, reintentos y errores).

### Estructura

```
server.js          servidor HTTP, sesiones y rutas estáticas
src/api.js         rutas de la API (/api/*) y webhook (/webhook/whatsapp)
src/whatsapp.js    conexión con la Cloud API y modo simulación
src/queue.js       cola de envío (reintentos, ventana de 24 h, bajas)
src/automations.js disparadores, recordatorios por fecha, palabras clave
src/inbound.js     mensajes entrantes y acuses de entrega
src/importer.js    importación de planillas
public/            interfaz (sin build, JavaScript nativo)
```

### Qué no incluye (todavía)

Envío de imágenes/audios/botones (solo texto y plantillas de texto; los adjuntos recibidos se registran como
`[image]`, `[audio]`…), usuarios múltiples con permisos, check-in en la puerta del evento, importación directa de `.xlsx`
(guardalo como CSV o pegá las celdas).
