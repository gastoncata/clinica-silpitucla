// API del simulador de chat (widget de la landing y "Probar el bot" del panel).
import { Router } from 'express';
import { handleIncoming, invalidateCache } from '../bot/engine.js';

const router = Router();

// Rate limit casero por IP: 20 mensajes por minuto.
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 20) return res.status(429).json({ error: 'Demasiados mensajes, esperá un momento.' });
  arr.push(now);
  hits.set(ip, arr);
  next();
}

router.post('/chat', rateLimit, async (req, res) => {
  try {
    const { conversationId, texto } = req.body || {};
    if (!texto || typeof texto !== 'string' || texto.length > 1000) {
      return res.status(400).json({ error: 'Mensaje inválido' });
    }
    const out = await handleIncoming({ conversationId: conversationId || null, canal: 'web', texto });
    res.json(out);
  } catch (e) {
    console.error('[chat]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// El panel avisa que cambió la config para refrescar el caché del bot al instante.
router.post('/bot/refresh', (_req, res) => {
  invalidateCache();
  res.json({ ok: true });
});

export default router;
