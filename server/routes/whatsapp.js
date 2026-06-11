// Webhook de WhatsApp Cloud API (Meta). Queda listo para conectar:
// 1. Crear app en developers.facebook.com -> producto WhatsApp.
// 2. Cargar WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_VERIFY_TOKEN en Render.
// 3. En Meta, configurar el webhook: https://TU-APP.onrender.com/api/whatsapp/webhook
//    con el mismo verify token, suscripto al campo "messages".
import { Router } from 'express';
import { handleIncoming } from '../bot/engine.js';

const router = Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'clinica-silpitucla-verify';
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Verificación inicial del webhook (Meta hace un GET)
router.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Mensajes entrantes
router.post('/whatsapp/webhook', async (req, res) => {
  // Responder 200 rápido: Meta reintenta si tardás.
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg || msg.type !== 'text') return;
    const telefono = msg.from; // ej: 5492995551234
    const nombre = entry?.contacts?.[0]?.profile?.name || null;
    const texto = msg.text?.body || '';

    const { replies } = await handleIncoming({ telefono, canal: 'whatsapp', nombre, texto });
    for (const r of replies) await sendWhatsApp(telefono, r);
  } catch (e) {
    console.error('[whatsapp webhook]', e);
  }
});

async function sendWhatsApp(to, body) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.warn('[whatsapp] Falta WHATSAPP_TOKEN/PHONE_NUMBER_ID: no se envió la respuesta.');
    return;
  }
  const resp = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!resp.ok) console.error('[whatsapp send]', resp.status, await resp.text());
}

export default router;
