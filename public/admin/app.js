// ============================================================
// Panel de administración — habla directo con Supabase (RLS)
// y con la API local del bot para el simulador.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
const fmtTime = (iso) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2200);
}

async function refreshBotCache() {
  try { await fetch('/api/bot/refresh', { method: 'POST' }); } catch {}
}

// ---------------- Autenticación ----------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.style.display = 'none';
  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-pass').value,
  });
  if (error) {
    err.textContent = 'Email o contraseña incorrectos.';
    err.style.display = 'block';
    return;
  }
  enter();
});

$('#logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function enter() {
  $('#login-screen').style.display = 'none';
  $('#app').classList.add('on');
  loadResumen();
  updatePendBadge();
  subscribeRealtime();
}

const { data: { session } } = await sb.auth.getSession();
if (session) enter();

// ---------------- Navegación ----------------
const loaders = { resumen: loadResumen, pendientes: loadPendientes, conversaciones: loadConvs, turnos: loadTurnos, faqs: loadFaqs, config: loadConfig, probar: initSim };
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('on'));
  $('#view-' + btn.dataset.view).classList.add('on');
  loaders[btn.dataset.view]?.();
});

// ---------------- Resumen ----------------
async function loadResumen() {
  const [convs, msgs, turnosPend, faqsOn, daily, intents] = await Promise.all([
    sb.from('conversations').select('id', { count: 'exact', head: true }),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('rol', 'bot'),
    sb.from('appointments').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
    sb.from('faqs').select('id', { count: 'exact', head: true }).eq('activa', true),
    sb.from('metrics_daily').select('*'),
    sb.from('metrics_intents').select('*').limit(6),
  ]);
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="v">${convs.count ?? 0}</div><div class="l">Conversaciones</div></div>
    <div class="kpi"><div class="v">${msgs.count ?? 0}</div><div class="l">Respuestas automáticas</div></div>
    <div class="kpi"><div class="v">${turnosPend.count ?? 0}</div><div class="l">Turnos por confirmar</div></div>
    <div class="kpi"><div class="v">${faqsOn.count ?? 0}</div><div class="l">Respuestas configuradas</div></div>`;

  // Gráfico de los últimos 14 días
  const byDay = Object.fromEntries((daily.data || []).map((d) => [d.dia, d]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, lbl: d.toLocaleDateString('es-AR', { day: '2-digit' }), ...byDay[key] });
  }
  const max = Math.max(1, ...days.map((d) => (d.recibidos || 0) + (d.respondidos || 0)));
  $('#chart').innerHTML = days
    .map((d) => {
      const tot = (d.recibidos || 0) + (d.respondidos || 0);
      return `<div class="bar ${tot ? 'b2' : ''}" style="height:${Math.round((tot / max) * 100)}%" data-tip="${d.lbl}: ${tot} mensajes"></div>`;
    })
    .join('');
  $('#chart-x').innerHTML = days.map((d) => `<span>${d.lbl}</span>`).join('');

  const labels = { turnos: '📅 Pedidos de turno', derivacion: '🙋 Derivaciones a Camila', saludo: '👋 Saludos', no_entiendo: '❓ Sin respuesta', '(sin clasificar)': 'Otros' };
  $('#toplist').innerHTML =
    (intents.data || [])
      .map((i) => `<li><span>${esc(labels[i.intent] || '💬 ' + i.intent.replaceAll('_', ' '))}</span><span class="n">${i.total}</span></li>`)
      .join('') || '<li>Sin datos todavía</li>';
}

// ---------------- Pendientes ----------------
// Conversaciones cuyo último mensaje es del paciente (nadie respondió aún)
// + turnos en estado pendiente, con acciones rápidas.
async function getPendingData() {
  const { data: convs } = await sb.from('conversations').select('*').eq('estado', 'abierta').order('last_message_at', { ascending: false }).limit(50);
  const ids = (convs || []).map((c) => c.id);
  const byConv = {};
  if (ids.length) {
    const { data: msgs } = await sb.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: false }).limit(400);
    for (const m of msgs || []) (byConv[m.conversation_id] ||= []).push(m);
  }
  const waiting = (convs || []).filter((c) => byConv[c.id]?.[0]?.rol === 'paciente');
  const { data: turnos } = await sb.from('appointments').select('*').eq('estado', 'pendiente').order('created_at', { ascending: false });
  return { waiting, byConv, turnos: turnos || [] };
}

async function updatePendBadge() {
  const { waiting, turnos } = await getPendingData();
  const n = waiting.length + turnos.length;
  const b = $('#pend-badge');
  b.hidden = n === 0;
  b.textContent = n;
}

async function loadPendientes() {
  const { waiting, byConv, turnos } = await getPendingData();
  const b = $('#pend-badge');
  b.hidden = waiting.length + turnos.length === 0;
  b.textContent = waiting.length + turnos.length;

  $('#pend-convs').innerHTML =
    waiting
      .map((c) => {
        const ult = (byConv[c.id] || []).slice(0, 3).reverse();
        return `
      <div class="pend-card" data-id="${c.id}">
        <div class="r1">
          <span class="who">${esc(c.nombre || 'Sin nombre')}</span>
          <span class="badge ${c.canal}">${c.canal === 'whatsapp' ? 'WhatsApp' : 'Web'}</span>
          <span class="badge ${c.modo}">${c.modo === 'bot' ? '🤖 Bot' : '🙋 Vos'}</span>
          <span class="tel">${esc(c.telefono)}</span>
          <span class="when">${fmtTime(c.last_message_at)}</span>
        </div>
        <div class="pend-msgs">
          ${ult.map((m) => `<div class="msg ${m.rol}">${md(m.texto)}</div>`).join('')}
        </div>
        <div class="pend-reply">
          <input class="p-in" placeholder="Responder como Camila…" maxlength="1000">
          <button class="btn btn-primary btn-sm p-send">Responder</button>
          ${c.modo === 'humano' ? '<button class="btn btn-ghost btn-sm p-bot">Devolver al bot</button>' : ''}
          <button class="btn btn-ghost btn-sm p-close">Marcar resuelto</button>
        </div>
      </div>`;
      })
      .join('') || '<div class="pend-empty">🎉 Nada esperando respuesta. El bot tiene todo bajo control.</div>';

  $('#pend-turnos').innerHTML =
    turnos
      .map(
        (t) => `
      <div class="pend-turno" data-id="${t.id}">
        <div class="info">
          <b>${esc(t.nombre)}</b> · <span class="d">${esc(t.telefono)}</span>
          <div class="d">${esc(t.motivo || 'Sin motivo')} — prefiere: ${esc(t.preferencia || 'sin preferencia')}</div>
        </div>
        <button class="btn btn-ok btn-sm t-ok">✓ Confirmar</button>
        <button class="btn btn-danger btn-sm t-no">✕ Cancelar</button>
      </div>`
      )
      .join('') || '<div class="pend-empty">Sin turnos por confirmar.</div>';
}

$('#pend-convs').addEventListener('click', async (e) => {
  const card = e.target.closest('.pend-card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.classList.contains('p-send')) {
    const v = card.querySelector('.p-in').value.trim();
    if (!v) { toast('Escribí la respuesta primero'); return; }
    await sb.from('messages').insert({ conversation_id: id, rol: 'humano', texto: v });
    await sb.from('conversations').update({ modo: 'humano', last_message_at: new Date().toISOString() }).eq('id', id);
    toast('Respuesta enviada');
    loadPendientes();
  }
  if (e.target.classList.contains('p-bot')) {
    await sb.from('conversations').update({ modo: 'bot' }).eq('id', id);
    toast('El bot vuelve a responder esta conversación');
    loadPendientes();
  }
  if (e.target.classList.contains('p-close')) {
    await sb.from('conversations').update({ estado: 'cerrada' }).eq('id', id);
    toast('Conversación marcada como resuelta');
    loadPendientes();
  }
});

$('#pend-convs').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('p-in')) {
    e.target.closest('.pend-card').querySelector('.p-send').click();
  }
});

$('#pend-turnos').addEventListener('click', async (e) => {
  const row = e.target.closest('.pend-turno');
  if (!row) return;
  if (e.target.classList.contains('t-ok')) {
    await sb.from('appointments').update({ estado: 'confirmado' }).eq('id', row.dataset.id);
    toast('Turno confirmado');
    loadPendientes();
  }
  if (e.target.classList.contains('t-no')) {
    await sb.from('appointments').update({ estado: 'cancelado' }).eq('id', row.dataset.id);
    toast('Turno cancelado');
    loadPendientes();
  }
});

// ---------------- Conversaciones ----------------
let selConv = null;
let convCache = [];

async function loadConvs() {
  const { data } = await sb.from('conversations').select('*').order('last_message_at', { ascending: false }).limit(100);
  convCache = data || [];
  $('#conv-list').innerHTML =
    convCache
      .map(
        (c) => `
    <div class="conv-item ${selConv === c.id ? 'sel' : ''}" data-id="${c.id}">
      <div class="r1"><span class="who">${esc(c.nombre || 'Sin nombre')}</span><span class="when">${fmtTime(c.last_message_at)}</span></div>
      <div class="r2">
        <span class="badge ${c.canal}">${c.canal === 'whatsapp' ? 'WhatsApp' : 'Web'}</span>
        <span class="badge ${c.modo}">${c.modo === 'bot' ? '🤖 Bot' : '🙋 Camila'}</span>
        <span class="tel">${esc(c.telefono)}</span>
      </div>
    </div>`
      )
      .join('') || '<div class="empty">Sin conversaciones todavía</div>';
}

$('#conv-list').addEventListener('click', (e) => {
  const item = e.target.closest('.conv-item');
  if (item) openConv(item.dataset.id);
});

async function openConv(id) {
  selConv = id;
  document.querySelectorAll('.conv-item').forEach((i) => i.classList.toggle('sel', i.dataset.id === id));
  const conv = convCache.find((c) => c.id === id);
  const { data: msgs } = await sb.from('messages').select('*').eq('conversation_id', id).order('created_at');
  const rolName = { paciente: esc(conv?.nombre || 'Paciente'), bot: '🤖 Bot', humano: '🙋 Camila' };
  $('#conv-detail').innerHTML = `
    <div class="conv-head">
      <div><div class="who">${esc(conv?.nombre || 'Sin nombre')}</div><div class="tel">${esc(conv?.telefono || '')}</div></div>
      <span class="badge ${conv.modo}">${conv.modo === 'bot' ? '🤖 Responde el bot' : '🙋 Atiende Camila'}</span>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" id="conv-toggle">${conv.modo === 'bot' ? 'Tomar control' : 'Devolver al bot'}</button>
      </div>
    </div>
    <div class="conv-msgs" id="conv-msgs">
      ${(msgs || []).map((m) => `<div class="msg ${m.rol}">${md(m.texto)}<span class="meta">${rolName[m.rol]} · ${fmtTime(m.created_at)}</span></div>`).join('')}
    </div>
    <div class="conv-reply">
      <input id="conv-reply-in" placeholder="Responder como Camila…" maxlength="1000">
      <button class="btn btn-primary btn-sm" id="conv-reply-btn">Enviar</button>
    </div>`;
  const box = $('#conv-msgs');
  box.scrollTop = box.scrollHeight;

  $('#conv-toggle').addEventListener('click', async () => {
    const nuevo = conv.modo === 'bot' ? 'humano' : 'bot';
    await sb.from('conversations').update({ modo: nuevo }).eq('id', id);
    toast(nuevo === 'humano' ? 'Tomaste el control de la conversación' : 'El bot vuelve a responder');
    await loadConvs();
    openConv(id);
  });
  const sendReply = async () => {
    const v = $('#conv-reply-in').value.trim();
    if (!v) return;
    $('#conv-reply-in').value = '';
    await sb.from('messages').insert({ conversation_id: id, rol: 'humano', texto: v });
    await sb.from('conversations').update({ modo: 'humano', last_message_at: new Date().toISOString() }).eq('id', id);
    await loadConvs();
    openConv(id);
  };
  $('#conv-reply-btn').addEventListener('click', sendReply);
  $('#conv-reply-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReply(); });
}

// Realtime: si llega un mensaje nuevo, refrescar lo que esté a la vista
function subscribeRealtime() {
  sb.channel('panel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      if ($('#view-conversaciones').classList.contains('on')) {
        loadConvs();
        if (selConv && payload.new.conversation_id === selConv) openConv(selConv);
      }
      if ($('#view-pendientes').classList.contains('on')) loadPendientes();
      else updatePendBadge();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
      if ($('#view-turnos').classList.contains('on')) loadTurnos();
      if ($('#view-pendientes').classList.contains('on')) loadPendientes();
      else updatePendBadge();
    })
    .subscribe();
}

// ---------------- Turnos ----------------
async function loadTurnos() {
  const filter = $('#turnos-filter').value;
  let q = sb.from('appointments').select('*').order('created_at', { ascending: false });
  if (filter) q = q.eq('estado', filter);
  const { data } = await q;
  $('#turnos-body').innerHTML =
    (data || [])
      .map(
        (t) => `
    <tr data-id="${t.id}">
      <td><b>${esc(t.nombre)}</b><br><span style="font-size:.8rem;color:var(--muted)">${esc(t.telefono)}</span></td>
      <td>${esc(t.motivo || '—')}</td>
      <td>${esc(t.preferencia || '—')}</td>
      <td><input type="datetime-local" class="t-fecha" value="${t.fecha ? new Date(t.fecha).toISOString().slice(0, 16) : ''}" style="width:190px"></td>
      <td>
        <select class="t-estado" style="width:140px">
          ${['pendiente', 'confirmado', 'atendido', 'cancelado'].map((e) => `<option value="${e}" ${t.estado === e ? 'selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}
        </select>
      </td>
      <td><input class="t-notas" value="${esc(t.notas || '')}" placeholder="Notas…" style="min-width:160px"></td>
    </tr>`
      )
      .join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No hay turnos con ese filtro</td></tr>';
}

$('#turnos-filter').addEventListener('change', loadTurnos);
$('#turnos-body').addEventListener('change', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const patch = {
    estado: tr.querySelector('.t-estado').value,
    notas: tr.querySelector('.t-notas').value || null,
    fecha: tr.querySelector('.t-fecha').value ? new Date(tr.querySelector('.t-fecha').value).toISOString() : null,
  };
  await sb.from('appointments').update(patch).eq('id', tr.dataset.id);
  toast('Turno actualizado');
});

// ---------------- FAQs ----------------
async function loadFaqs() {
  const { data } = await sb.from('faqs').select('*').order('orden');
  $('#faq-list').innerHTML = (data || []).map(faqCard).join('') || '<div class="cardbox">Sin respuestas configuradas.</div>';
}

function faqCard(f) {
  return `
  <div class="faq-item" data-id="${f.id}">
    <div class="r1">
      <label class="switch"><input type="checkbox" class="f-activa" ${f.activa ? 'checked' : ''}><i></i></label>
      <h3>${esc(f.pregunta)}</h3>
      <button class="btn btn-ghost btn-sm f-edit">Editar</button>
      <button class="btn btn-danger btn-sm f-del">Borrar</button>
    </div>
    <div>${(f.keywords || []).map((k) => `<span class="kw">${esc(k)}</span>`).join('')}</div>
    <p class="faq-resp" style="margin-top:8px">${md(f.respuesta)}</p>
  </div>`;
}

function faqForm(f = {}) {
  return `
  <div class="faq-item" data-id="${f.id || ''}" data-editing="1">
    <div class="field"><label>Tema (para identificarla en el panel)</label><input class="fe-pregunta" value="${esc(f.pregunta || '')}" placeholder="Ej: Horarios de atención"></div>
    <div class="field"><label>Palabras clave (separadas por coma — si el paciente las menciona, el bot responde esto)</label><input class="fe-keywords" value="${esc((f.keywords || []).join(', '))}" placeholder="horario, hora, atienden, cuando"></div>
    <div class="field"><label>Respuesta del bot (usá *asteriscos* para negrita estilo WhatsApp)</label><textarea class="fe-respuesta">${esc(f.respuesta || '')}</textarea></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm fe-save">Guardar</button>
      <button class="btn btn-ghost btn-sm fe-cancel">Cancelar</button>
    </div>
  </div>`;
}

$('#faq-new').addEventListener('click', () => {
  $('#faq-list').insertAdjacentHTML('afterbegin', faqForm());
});

$('#faq-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.faq-item');
  if (!card) return;
  const id = card.dataset.id;

  if (e.target.classList.contains('f-edit')) {
    const { data } = await sb.from('faqs').select('*').eq('id', id).single();
    card.outerHTML = faqForm(data);
  }
  if (e.target.classList.contains('f-del')) {
    if (!confirm('¿Borrar esta respuesta del bot?')) return;
    await sb.from('faqs').delete().eq('id', id);
    await refreshBotCache();
    toast('Respuesta eliminada');
    loadFaqs();
  }
  if (e.target.classList.contains('fe-cancel')) loadFaqs();
  if (e.target.classList.contains('fe-save')) {
    const payload = {
      pregunta: card.querySelector('.fe-pregunta').value.trim(),
      keywords: card.querySelector('.fe-keywords').value.split(',').map((s) => s.trim()).filter(Boolean),
      respuesta: card.querySelector('.fe-respuesta').value.trim(),
    };
    if (!payload.pregunta || !payload.respuesta || payload.keywords.length === 0) {
      toast('Completá tema, palabras clave y respuesta');
      return;
    }
    if (id) await sb.from('faqs').update(payload).eq('id', id);
    else await sb.from('faqs').insert(payload);
    await refreshBotCache();
    toast('Respuesta guardada · el bot ya la usa');
    loadFaqs();
  }
});

$('#faq-list').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('f-activa')) return;
  const card = e.target.closest('.faq-item');
  await sb.from('faqs').update({ activa: e.target.checked }).eq('id', card.dataset.id);
  await refreshBotCache();
  toast(e.target.checked ? 'Respuesta activada' : 'Respuesta desactivada');
});

// ---------------- Configuración ----------------
async function loadConfig() {
  const { data } = await sb.from('clinic_config').select('*');
  const cfg = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const inst = cfg.institucional || {};
  const bot = cfg.bot || {};
  const flujo = cfg.flujo_turnos || { pasos: [] };

  $('#cfg-profesional').value = inst.profesional || '';
  $('#cfg-matricula').value = inst.matricula || '';
  $('#cfg-direccion').value = inst.direccion || '';
  $('#cfg-horarios').value = inst.horarios || '';
  $('#cfg-telefono').value = inst.telefono_whatsapp || '';
  $('#cfg-especialidades').value = (inst.especialidades || []).join('\n');
  $('#cfg-obras').value = (inst.obras_sociales || []).join('\n');

  $('#cfg-bot-activo').checked = bot.activo !== false;
  $('#cfg-bot-nombre').value = bot.nombre_bot || '';
  $('#cfg-bot-tono').value = bot.tono || 'empatico';
  $('#cfg-bot-bienvenida').value = bot.mensaje_bienvenida || '';
  $('#cfg-bot-noentiendo').value = bot.mensaje_no_entiendo || '';
  $('#cfg-bot-derivacion').value = bot.mensaje_derivacion || '';

  for (let i = 0; i < 3; i++) $('#cfg-flujo-' + i).value = flujo.pasos?.[i]?.pregunta || '';
  $('#cfg-flujo-conf').value = flujo.mensaje_confirmacion || '';
}

$('#cfg-save').addEventListener('click', async () => {
  const { data } = await sb.from('clinic_config').select('*');
  const cfg = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const inst = { ...(cfg.institucional || {}) };
  Object.assign(inst, {
    profesional: $('#cfg-profesional').value.trim(),
    matricula: $('#cfg-matricula').value.trim(),
    direccion: $('#cfg-direccion').value.trim(),
    horarios: $('#cfg-horarios').value.trim(),
    telefono_whatsapp: $('#cfg-telefono').value.trim(),
    especialidades: $('#cfg-especialidades').value.split('\n').map((s) => s.trim()).filter(Boolean),
    obras_sociales: $('#cfg-obras').value.split('\n').map((s) => s.trim()).filter(Boolean),
  });
  const bot = {
    ...(cfg.bot || {}),
    activo: $('#cfg-bot-activo').checked,
    nombre_bot: $('#cfg-bot-nombre').value.trim(),
    tono: $('#cfg-bot-tono').value,
    mensaje_bienvenida: $('#cfg-bot-bienvenida').value.trim(),
    mensaje_no_entiendo: $('#cfg-bot-noentiendo').value.trim(),
    mensaje_derivacion: $('#cfg-bot-derivacion').value.trim(),
  };
  const campos = ['nombre', 'motivo', 'preferencia'];
  const flujo = {
    pasos: campos.map((campo, i) => ({ campo, pregunta: $('#cfg-flujo-' + i).value.trim() })).filter((p) => p.pregunta),
    mensaje_confirmacion: $('#cfg-flujo-conf').value.trim(),
  };
  const rows = [
    { key: 'institucional', value: inst, updated_at: new Date().toISOString() },
    { key: 'bot', value: bot, updated_at: new Date().toISOString() },
    { key: 'flujo_turnos', value: flujo, updated_at: new Date().toISOString() },
  ];
  const { error } = await sb.from('clinic_config').upsert(rows);
  if (error) { toast('Error al guardar: ' + error.message); return; }
  await refreshBotCache();
  toast('Configuración guardada · el bot ya la usa');
});

// ---------------- Probar el bot ----------------
let simConvId = null;
let simStarted = false;

function initSim() {
  sb.from('clinic_config').select('value').eq('key', 'bot').single().then(({ data }) => {
    if (data?.value?.nombre_bot) $('#sim-name').textContent = data.value.nombre_bot;
  });
  if (!simStarted) { simStarted = true; simSend('hola', true); }
}

function simAdd(rol, texto) {
  const d = document.createElement('div');
  // quien escribe (vos, como paciente) va a la derecha en verde; el bot a la izquierda
  d.className = 'msg ' + (rol === 'user' ? 'bot' : 'paciente');
  d.innerHTML = md(texto);
  $('#sim-msgs').appendChild(d);
  $('#sim-msgs').scrollTop = $('#sim-msgs').scrollHeight;
}

async function simSend(texto, silent = false) {
  if (!silent) simAdd('user', texto);
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: simConvId, texto }),
    });
    const data = await r.json();
    simConvId = data.conversationId || simConvId;
    for (const rep of data.replies || []) simAdd('bot', rep);
    if (!silent && (data.replies || []).length === 0) simAdd('bot', '(El bot está en modo humano o apagado: no responde automáticamente)');
  } catch {
    simAdd('bot', '⚠️ No pude conectar con la API del bot. ¿Está corriendo el servidor?');
  }
}

$('#sim-send').addEventListener('click', () => {
  const v = $('#sim-in').value.trim();
  if (!v) return;
  $('#sim-in').value = '';
  simSend(v);
});
$('#sim-in').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = $('#sim-in').value.trim();
  if (!v) return;
  $('#sim-in').value = '';
  simSend(v);
});
$('#sim-reset').addEventListener('click', () => {
  simConvId = null;
  $('#sim-msgs').innerHTML = '';
  simSend('hola', true);
});
