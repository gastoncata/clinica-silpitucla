# Clínica · Lic. Camila Silpitucla — Web + Bot de WhatsApp + Panel

Sitio público, asistente virtual configurable y panel de administración para gestionar las respuestas del bot, las conversaciones y los turnos.

## Arquitectura

```
Paciente (web o WhatsApp)
        │
        ▼
Node/Express en Render  ──►  Motor del bot (server/bot/engine.js)
  ├─ /               web pública + widget de chat            │
  ├─ /admin          panel de administración                 ▼
  ├─ /api/chat       simulador (mismo motor que WhatsApp)  Supabase
  └─ /api/whatsapp   webhook Meta Cloud API          (config, FAQs, chats, turnos)
```

- **El bot no tiene nada hardcodeado**: bienvenida, tono, FAQs, flujo de turnos y datos de la clínica viven en Supabase y se editan desde `/admin`. Los cambios impactan al instante.
- **El widget de la web y WhatsApp usan el mismo motor**, así que la demo del widget es fiel a lo que hará el bot real.

## Correr local

```bash
npm install
cp .env.example .env   # completar SUPABASE_SERVICE_ROLE_KEY
npm start              # http://localhost:3000  ·  panel: /admin
```

La clave `service_role` está en: Supabase Dashboard → proyecto `clinica-silpitucla` → Project Settings → API Keys.

**Login del panel (demo):** `admin@clinica.demo` / `CamilaDemo2026`

## Deploy en Render

1. Subir esta carpeta a un repo de GitHub.
2. En [render.com](https://render.com): **New → Blueprint** y elegir el repo (usa `render.yaml`), o **New → Web Service** con build `npm install` y start `npm start`.
3. Cargar la variable `SUPABASE_SERVICE_ROLE_KEY` en *Environment* (Render la pide porque está marcada como secreta).
4. Listo: `https://TU-APP.onrender.com`

> Plan free de Render: el servicio se duerme tras 15 min sin tráfico y tarda ~30-60 s en despertar. Para la demo con la clienta, abrí la página un minuto antes. Si se vende, el plan Starter (USD 7/mes) lo mantiene siempre despierto.

## Conectar WhatsApp real (cuando se venda)

1. Crear app en [developers.facebook.com](https://developers.facebook.com) → producto **WhatsApp**.
2. Copiar `WHATSAPP_TOKEN` (token permanente) y `WHATSAPP_PHONE_NUMBER_ID` a Render.
3. En Meta → WhatsApp → Configuración → Webhook:
   - URL: `https://TU-APP.onrender.com/api/whatsapp/webhook`
   - Verify token: el valor de `WHATSAPP_VERIFY_TOKEN` (por defecto `clinica-silpitucla-verify`)
   - Suscribirse al campo `messages`.
4. No hay que tocar código: el webhook ya usa el mismo motor que el simulador.

## Estructura

```
server/
  index.js            servidor Express (estáticos + API)
  supabase.js         cliente Supabase (service_role, solo servidor)
  bot/engine.js       motor del bot: intents, FAQs, flujo de turnos
  routes/chat.js      API del simulador + refresh de caché
  routes/whatsapp.js  webhook Meta Cloud API (listo para conectar)
public/
  index.html          web pública
  assets/chat.js      widget de chat de la landing
  admin/              panel (login Supabase Auth + RLS)
render.yaml           blueprint de deploy
```

## Seguridad

- La clave `anon` del frontend solo permite lo que autoriza RLS: sin login no se lee nada.
- La clave `service_role` vive únicamente en variables de entorno del servidor.
- El panel requiere usuario de Supabase Auth (gestionable desde el dashboard de Supabase → Authentication → Users).
- Rate limit en `/api/chat` (20 mensajes/min por IP).

## Pendientes para producción real

- Cargar datos reales (dirección, matrícula, horarios, obras sociales) desde el panel → Configuración.
- Reemplazar la cuenta demo por el email real de Camila.
- Si se conecta WhatsApp: responder desde el panel hoy guarda el mensaje en la conversación; para que además salga por WhatsApp hay que agregar el envío saliente en `routes/chat.js` (está hecho el helper en `routes/whatsapp.js`).
