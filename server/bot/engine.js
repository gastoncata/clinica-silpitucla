// =====================================================================
// Motor del bot. Toda su personalidad y conocimiento sale de Supabase
// (tablas clinic_config y faqs), que se editan desde el panel /admin.
// Lo usan por igual el simulador web y el webhook de WhatsApp.
// =====================================================================
import { db } from '../supabase.js';

// ---------- Config con caché (30 s) para que cada mensaje sea rápido ----------
let cache = { at: 0, config: null, faqs: null };
const CACHE_MS = 30_000;

export async function loadKnowledge(force = false) {
  if (!force && cache.config && Date.now() - cache.at < CACHE_MS) return cache;
  const [cfgRes, faqRes] = await Promise.all([
    db.from('clinic_config').select('key,value'),
    db.from('faqs').select('*').eq('activa', true).order('orden'),
  ]);
  if (cfgRes.error) throw cfgRes.error;
  if (faqRes.error) throw faqRes.error;
  const config = Object.fromEntries(cfgRes.data.map((r) => [r.key, r.value]));
  cache = { at: Date.now(), config, faqs: faqRes.data };
  return cache;
}

export function invalidateCache() {
  cache = { at: 0, config: null, faqs: null };
}

// ---------- Utilidades de texto ----------
const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fill = (template, datos) =>
  (template || '').replace(/\{(\w+)\}/g, (_, k) => datos?.[k] ?? `{${k}}`);

const SALUDOS = ['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'hello', 'holis'];
const KW_TURNO = ['turno', 'cita', 'agendar', 'reservar', 'consulta', 'atenderme', 'sacar hora'];
const KW_HUMANO = ['humano', 'persona', 'camila', 'profesional', 'hablar con alguien', 'operador', 'asesor'];
const KW_CANCELAR = ['cancelar', 'salir', 'dejalo', 'olvidalo', 'no quiero'];

function detectIntent(texto, faqs) {
  const t = normalize(texto);
  if (!t) return { type: 'no_entiendo' };
  if (KW_CANCELAR.some((k) => t.includes(k))) return { type: 'cancelar' };
  if (KW_HUMANO.some((k) => t.includes(k))) return { type: 'humano' };
  if (KW_TURNO.some((k) => t.includes(k))) return { type: 'turno' };
  // FAQ con más keywords coincidentes gana
  let best = null;
  for (const f of faqs) {
    const hits = (f.keywords || []).filter((k) => t.includes(normalize(k))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { f, hits };
  }
  if (best) return { type: 'faq', faq: best.f };
  if (SALUDOS.some((k) => t === k || t.startsWith(k + ' ')) && t.length < 30) return { type: 'saludo' };
  return { type: 'no_entiendo' };
}

// ---------- Conversaciones ----------
async function getOrCreateConversation({ conversationId, telefono, canal, nombre }) {
  if (conversationId) {
    const { data } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (data) return data;
  }
  if (telefono) {
    const { data } = await db
      .from('conversations')
      .select('*')
      .eq('telefono', telefono)
      .eq('estado', 'abierta')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  const { data, error } = await db
    .from('conversations')
    .insert({ telefono: telefono || 'web', canal, nombre: nombre || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function saveMessage(conversation_id, rol, texto, intent = null) {
  await db.from('messages').insert({ conversation_id, rol, texto, intent });
}

// ---------- Núcleo: procesar un mensaje entrante ----------
// Devuelve { conversationId, replies: string[] }
export async function handleIncoming({ conversationId = null, telefono = null, canal = 'web', nombre = null, texto }) {
  const { config, faqs } = await loadKnowledge();
  const bot = config.bot || {};
  const flujo = config.flujo_turnos || { pasos: [] };

  const conv = await getOrCreateConversation({ conversationId, telefono, canal, nombre });
  const ctx = conv.contexto || {};
  const enFlujo = Boolean(ctx.turno);
  const intent = enFlujo ? { type: 'flujo' } : detectIntent(texto, faqs);

  const intentLabel =
    intent.type === 'faq' ? normalize(intent.faq.pregunta).replace(/\s+/g, '_')
    : intent.type === 'flujo' ? 'turnos'
    : intent.type === 'turno' ? 'turnos'
    : intent.type === 'humano' ? 'derivacion'
    : intent.type;
  await saveMessage(conv.id, 'paciente', texto, intentLabel);

  const replies = [];
  let newCtx = ctx;
  let newModo = conv.modo;

  if (conv.modo === 'humano') {
    // La conversación la maneja una persona: el bot no interviene.
    await touch(conv.id, newCtx, newModo);
    return { conversationId: conv.id, replies: [] };
  }

  if (bot.activo === false) {
    await touch(conv.id, newCtx, newModo);
    return { conversationId: conv.id, replies: [] };
  }

  if (enFlujo) {
    const t = normalize(texto);
    if (KW_CANCELAR.some((k) => t.includes(k))) {
      newCtx = {};
      replies.push('Listo, cancelé el pedido de turno 👍 ¿Te ayudo con otra cosa?');
    } else {
      const pasos = flujo.pasos || [];
      const i = ctx.turno.paso;
      const datos = { ...ctx.turno.datos, [pasos[i].campo]: texto.trim() };
      if (i + 1 < pasos.length) {
        newCtx = { turno: { paso: i + 1, datos } };
        replies.push(fill(pasos[i + 1].pregunta, datos));
      } else {
        // Flujo completo: crear turno
        await db.from('appointments').insert({
          conversation_id: conv.id,
          nombre: datos.nombre || conv.nombre || 'Sin nombre',
          telefono: conv.telefono || 'web',
          motivo: datos.motivo || null,
          preferencia: datos.preferencia || null,
          estado: 'pendiente',
        });
        if (datos.nombre && !conv.nombre) await db.from('conversations').update({ nombre: datos.nombre }).eq('id', conv.id);
        newCtx = {};
        replies.push(fill(flujo.mensaje_confirmacion, datos));
      }
    }
  } else {
    switch (intent.type) {
      case 'saludo':
        replies.push(bot.mensaje_bienvenida);
        break;
      case 'turno': {
        const pasos = flujo.pasos || [];
        if (pasos.length === 0) {
          replies.push(bot.mensaje_derivacion);
          newModo = 'humano';
        } else {
          newCtx = { turno: { paso: 0, datos: {} } };
          replies.push(fill(pasos[0].pregunta, {}));
        }
        break;
      }
      case 'humano':
        newModo = 'humano';
        replies.push(bot.mensaje_derivacion);
        break;
      case 'faq':
        replies.push(intent.faq.respuesta);
        break;
      case 'cancelar':
        replies.push('Sin problema 👍 ¿Te ayudo con otra cosa?');
        break;
      default:
        replies.push(bot.mensaje_no_entiendo);
    }
  }

  for (const r of replies) await saveMessage(conv.id, 'bot', r);
  await touch(conv.id, newCtx, newModo);
  return { conversationId: conv.id, replies };
}

async function touch(id, contexto, modo) {
  await db
    .from('conversations')
    .update({ contexto, modo, last_message_at: new Date().toISOString() })
    .eq('id', id);
}
