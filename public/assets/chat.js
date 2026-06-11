// Widget de chat: simula la experiencia del bot de WhatsApp usando la MISMA
// lógica y configuración real (API /api/chat -> motor del bot -> Supabase).
(function () {
  const css = `
  .cw-fab{position:fixed;right:20px;bottom:20px;z-index:90;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;
    background:#25D366;display:grid;place-items:center;box-shadow:0 12px 28px -10px rgba(18,140,80,.8);transition:transform .2s}
  .cw-fab:hover{transform:scale(1.07)}
  .cw-fab svg{width:30px;height:30px;fill:#fff}
  .cw-panel{position:fixed;right:20px;bottom:92px;z-index:91;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));
    background:#ECE5DD;border-radius:18px;overflow:hidden;display:none;flex-direction:column;
    box-shadow:0 30px 70px -20px rgba(13,27,54,.55);font-family:"Source Sans 3",system-ui,sans-serif}
  .cw-panel.open{display:flex}
  .cw-head{background:#075E54;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:11px}
  .cw-head img{width:38px;height:38px;border-radius:50%;background:#fff}
  .cw-head .t{line-height:1.2}
  .cw-head .t b{font-family:Lexend,system-ui,sans-serif;font-size:.95rem;display:block}
  .cw-head .t span{font-size:.76rem;opacity:.85}
  .cw-head button{margin-left:auto;background:none;border:0;color:#fff;font-size:1.3rem;cursor:pointer;padding:4px 8px}
  .cw-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px;
    background-image:radial-gradient(rgba(0,0,0,.025) 1px, transparent 1px);background-size:18px 18px}
  .cw-m{max-width:82%;padding:8px 12px;border-radius:10px;font-size:.93rem;line-height:1.45;white-space:pre-wrap;
    box-shadow:0 1px 1px rgba(0,0,0,.12);animation:cwIn .18s ease}
  .cw-m.bot{background:#fff;align-self:flex-start;border-top-left-radius:2px}
  .cw-m.user{background:#DCF8C6;align-self:flex-end;border-top-right-radius:2px}
  .cw-m strong{font-weight:700}
  .cw-typing{align-self:flex-start;background:#fff;border-radius:10px;padding:10px 14px;display:flex;gap:4px;box-shadow:0 1px 1px rgba(0,0,0,.12)}
  .cw-typing i{width:7px;height:7px;border-radius:50%;background:#9ab;animation:cwB 1s infinite}
  .cw-typing i:nth-child(2){animation-delay:.15s}.cw-typing i:nth-child(3){animation-delay:.3s}
  @keyframes cwB{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
  @keyframes cwIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .cw-foot{display:flex;gap:8px;padding:10px;background:#F0F0F0}
  .cw-foot input{flex:1;border:0;border-radius:999px;padding:11px 16px;font-size:.95rem;font-family:inherit;outline:none}
  .cw-foot button{width:44px;height:44px;border-radius:50%;border:0;background:#075E54;color:#fff;cursor:pointer;display:grid;place-items:center}
  .cw-foot button:disabled{opacity:.5}
  .cw-note{font-size:.7rem;text-align:center;color:#7a8699;background:#F0F0F0;padding:0 10px 8px}
  @media (max-width:480px){.cw-panel{right:8px;bottom:84px}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.innerHTML = `
    <button class="cw-fab" aria-label="Abrir chat de turnos">
      <svg viewBox="0 0 24 24"><path d="M12 2A10 10 0 0 0 2 12a9.9 9.9 0 0 0 1.5 5.3L2 22l4.9-1.4A10 10 0 1 0 12 2Zm5.7 14.1c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.2.2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.5c-.1.2-.3.3-.1.6.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.4 0 .1 0 .8-.2 1.5Z"/></svg>
    </button>
    <div class="cw-panel" role="dialog" aria-label="Chat con el asistente virtual">
      <div class="cw-head">
        <img src="/assets/logo.png" alt="">
        <div class="t"><b id="cw-name">Asistente de Camila</b><span>● en línea · responde al instante</span></div>
        <button aria-label="Cerrar chat" id="cw-close">×</button>
      </div>
      <div class="cw-msgs" id="cw-msgs"></div>
      <div class="cw-foot">
        <input id="cw-in" type="text" maxlength="500" placeholder="Escribí tu consulta…" autocomplete="off">
        <button id="cw-send" aria-label="Enviar"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2v7z"/></svg></button>
      </div>
      <div class="cw-note">Demo del asistente de WhatsApp · funciona con la configuración real del panel</div>
    </div>`;
  document.body.appendChild(el);

  const panel = el.querySelector('.cw-panel');
  const msgs = el.querySelector('#cw-msgs');
  const input = el.querySelector('#cw-in');
  const send = el.querySelector('#cw-send');
  let conversationId = null;
  let greeted = false;
  let busy = false;

  const md = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');

  function add(rol, texto) {
    const d = document.createElement('div');
    d.className = 'cw-m ' + (rol === 'user' ? 'user' : 'bot');
    d.innerHTML = md(texto);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function typing(on) {
    let t = msgs.querySelector('.cw-typing');
    if (on && !t) {
      t = document.createElement('div');
      t.className = 'cw-typing';
      t.innerHTML = '<i></i><i></i><i></i>';
      msgs.appendChild(t);
      msgs.scrollTop = msgs.scrollHeight;
    } else if (!on && t) t.remove();
  }

  async function sendText(texto) {
    add('user', texto);
    busy = true; send.disabled = true; typing(true);
    const t0 = Date.now();
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, texto }),
      });
      const data = await r.json();
      if (data.conversationId) conversationId = data.conversationId;
      // pequeña pausa para que se sienta natural
      await new Promise((ok) => setTimeout(ok, Math.max(0, 700 - (Date.now() - t0))));
      typing(false);
      for (const rep of data.replies || []) add('bot', rep);
      if ((data.replies || []).length === 0) add('bot', 'Recibido 👍 Camila te va a responder personalmente por este chat.');
    } catch {
      typing(false);
      add('bot', 'Ups, hubo un problema de conexión. Probá de nuevo en un ratito 🙏');
    }
    busy = false; send.disabled = false; input.focus();
  }

  function open() {
    panel.classList.add('open');
    input.focus();
    if (!greeted) {
      greeted = true;
      typing(true);
      setTimeout(() => { typing(false); sendGreeting(); }, 600);
    }
  }
  async function sendGreeting() {
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, texto: 'hola' }),
      });
      const data = await r.json();
      conversationId = data.conversationId || null;
      // mostramos solo la respuesta del bot (el "hola" inicial es automático)
      for (const rep of data.replies || []) add('bot', rep);
    } catch {
      add('bot', '¡Hola! 👋 Ahora mismo no puedo conectarme. Probá de nuevo en unos minutos.');
    }
  }

  el.querySelector('.cw-fab').addEventListener('click', () =>
    panel.classList.contains('open') ? panel.classList.remove('open') : open()
  );
  el.querySelector('#cw-close').addEventListener('click', () => panel.classList.remove('open'));
  document.querySelectorAll('[data-open-chat]').forEach((b) => b.addEventListener('click', open));

  function submit() {
    const v = input.value.trim();
    if (!v || busy) return;
    input.value = '';
    sendText(v);
  }
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
})();
