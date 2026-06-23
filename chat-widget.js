(function () {
if (window.RS_CHAT_WIDGET_LOADED) return;
window.RS_CHAT_WIDGET_LOADED = true;

const CURRENT_FILE = (location.pathname.split('/').pop() || 'home.html').toLowerCase();
const DISABLED_ON = new Set(['index.html', 'first-admin-setup.html', 'messages.html']);
if (DISABLED_ON.has(CURRENT_FILE)) return;

const FALLBACK_SUPABASE_URL = 'https://usmeoqyzlnxnoighhiga.supabase.co';
const FALLBACK_SUPABASE_KEY = 'sb_publishable_r5uttSQDB3twbwYYN5-EMg_57_GPPXO';

const state = {
profile: null,
client: null,
realtime: null,
channel: null,
allowedClients: [],
coaches: [],
selectedClient: null,
conversation: null,
senderProfiles: {},
isOpen: false,
booted: false,
loading: false,
lastError: ''
};

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c] || c));
}

  function pack(value) {
return encodeURIComponent(String(value || ''));
}

function unpack(value) {
return decodeURIComponent(String(value || ''));
}

function getSupabaseUrl() {
try {
if (typeof RS_SUPABASE_URL !== 'undefined') return RS_SUPABASE_URL;
} catch {}
return FALLBACK_SUPABASE_URL;
}

function getSupabaseKey() {
try {
if (typeof RS_SUPABASE_KEY !== 'undefined') return RS_SUPABASE_KEY;
} catch {}
return FALLBACK_SUPABASE_KEY;
}

function sessionFromStorage() {
try {
return JSON.parse(localStorage.getItem('rs_auth_session') || 'null');
} catch {
return null;
}
}

function scriptLoaded(srcPart) {
return Array.from(document.scripts || []).some(script => String(script.src || '').includes(srcPart));
}

function loadScript(src) {
return new Promise((resolve, reject) => {
if (scriptLoaded(src)) return resolve();

  const script = document.createElement('script');
  script.src = src;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error(`Failed to load ${src}`));
  document.head.appendChild(script);
});

}

async function ensureDependencies() {
if (!window.rsAuth) {
await loadScript('app-auth.js');
}

if (!window.supabase) {
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
}

}

function iconSvg() {
return `       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true">         <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3.75h5.25M21 12c0 4.142-4.03 7.5-9 7.5a10.8 10.8 0 0 1-3.47-.57L3 21l1.66-4.42C3.61 15.32 3 13.72 3 12c0-4.142 4.03-7.5 9-7.5s9 3.358 9 7.5Z" />       </svg>`;
}

function injectStyles() {
if (document.getElementById('rs-chat-widget-style')) return;

const style = document.createElement('style');
style.id = 'rs-chat-widget-style';
style.textContent = `
  #rs-chat-fab {
    position: fixed;
    top: 22px;
    right: 145px;
    z-index: 9998;
    width: 48px;
    height: 48px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,.15);
    background: rgba(18,18,18,.92);
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 18px 45px rgba(0,0,0,.35), 0 0 0 1px rgba(139,0,0,.2);
    backdrop-filter: blur(12px);
    transition: transform .2s ease, border-color .2s ease, background .2s ease;
  }
  #rs-chat-fab:hover { transform: translateY(-2px); border-color:#cc0000; background:rgba(139,0,0,.35); }
  #rs-chat-fab svg { width:22px; height:22px; }
  #rs-chat-fab .rs-chat-pulse {
    position:absolute;
    top:9px;
    right:9px;
    width:8px;
    height:8px;
    border-radius:999px;
    background:#00c864;
    box-shadow:0 0 14px rgba(0,200,100,.85);
  }
  #rs-chat-shade {
    position: fixed;
    inset: 0;
    z-index: 9996;
    background: rgba(0,0,0,.48);
    opacity: 0;
    pointer-events: none;
    transition: opacity .22s ease;
  }
  #rs-chat-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(460px, 96vw);
    height: 100vh;
    z-index: 9997;
    background: #0d0d0d;
    color: #fff;
    border-left: 1px solid rgba(139,0,0,.45);
    box-shadow: -28px 0 80px rgba(0,0,0,.45);
    transform: translateX(102%);
    transition: transform .25s ease;
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body.rs-chat-open #rs-chat-shade { opacity:1; pointer-events:auto; }
  body.rs-chat-open #rs-chat-drawer { transform:translateX(0); }
  .rs-chat-head { padding:18px; border-bottom:1px solid rgba(139,0,0,.35); background:linear-gradient(135deg,rgba(139,0,0,.18),rgba(255,255,255,.02)); display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
  .rs-chat-title { font-family:'Bebas Neue', Impact, sans-serif; letter-spacing:2px; font-size:1.7rem; line-height:1; }
  .rs-chat-title span { color:#cc0000; }
  .rs-chat-sub { color:#9ca3af; font-size:.8rem; margin-top:6px; line-height:1.4; }
  .rs-chat-close { border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); color:#fff; width:38px; height:38px; border-radius:999px; cursor:pointer; font-size:1.2rem; line-height:1; }
  .rs-chat-close:hover { border-color:#cc0000; background:rgba(139,0,0,.3); }
  .rs-chat-list { border-bottom:1px solid rgba(139,0,0,.25); padding:12px; max-height:210px; overflow:auto; background:rgba(255,255,255,.018); }
  .rs-chat-list:empty { display:none; }
  .rs-chat-list-btn { width:100%; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.035); color:#fff; border-radius:14px; padding:12px; display:flex; gap:10px; align-items:center; text-align:left; cursor:pointer; margin-bottom:8px; }
  .rs-chat-list-btn:hover, .rs-chat-list-btn.active { border-color:#cc0000; background:rgba(139,0,0,.22); }
  .rs-chat-avatar { width:36px; height:36px; border-radius:999px; flex:0 0 auto; display:grid; place-items:center; font-weight:950; background:linear-gradient(135deg,#8B0000,#cc0000); }
  .rs-chat-person { font-weight:900; font-size:.93rem; }
  .rs-chat-meta { color:#9ca3af; font-size:.74rem; margin-top:3px; }
  .rs-chat-messages { overflow:auto; padding:16px; display:flex; flex-direction:column; gap:10px; background:radial-gradient(circle at top left,rgba(139,0,0,.12),transparent 40%); }
  .rs-chat-empty { color:#9ca3af; text-align:center; line-height:1.55; padding:26px 18px; }
  .rs-chat-row { display:flex; align-items:flex-end; gap:7px; }
  .rs-chat-row.mine { justify-content:flex-end; }
  .rs-chat-bubble { max-width:82%; border:1px solid rgba(255,255,255,.1); background:#181818; border-radius:18px; padding:11px 12px; }
  .rs-chat-row.mine .rs-chat-bubble { background:linear-gradient(135deg,#8B0000,#cc0000); border-color:rgba(255,255,255,.08); }
  .rs-chat-row.deleted .rs-chat-bubble { background:rgba(255,255,255,.035); border-style:dashed; color:#9ca3af; }
  .rs-chat-msg-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:5px; }
  .rs-chat-sender { font-size:.66rem; text-transform:uppercase; letter-spacing:1px; font-weight:950; color:#d1d5db; }
  .rs-chat-row.mine .rs-chat-sender { color:#fff; }
  .rs-chat-time { font-size:.66rem; color:#9ca3af; white-space:nowrap; }
  .rs-chat-row.mine .rs-chat-time { color:rgba(255,255,255,.75); }
  .rs-chat-text { white-space:pre-wrap; line-height:1.45; font-size:.9rem; }
  .rs-chat-delete { border:0; background:transparent; color:#ffb3b3; font-size:.64rem; font-weight:950; letter-spacing:1px; text-transform:uppercase; cursor:pointer; padding:5px 0 0; }
  .rs-chat-delete:hover { color:#fff; }
  .rs-chat-compose { border-top:1px solid rgba(139,0,0,.3); padding:12px; display:grid; grid-template-columns:1fr auto; gap:10px; background:rgba(8,8,8,.88); }
  #rs-chat-input { width:100%; min-height:48px; max-height:130px; resize:vertical; border:1px solid rgba(255,255,255,.12); border-radius:13px; background:#1d1d1d; color:#fff; padding:12px; outline:none; font: inherit; }
  #rs-chat-input:focus { border-color:#cc0000; box-shadow:0 0 0 3px rgba(204,0,0,.12); }
  #rs-chat-send { border:0; border-radius:12px; background:linear-gradient(135deg,#8B0000,#cc0000); color:#fff; padding:0 16px; font-weight:950; letter-spacing:1px; text-transform:uppercase; cursor:pointer; }
  #rs-chat-send:disabled, #rs-chat-input:disabled { opacity:.45; cursor:not-allowed; }
  .rs-chat-notice { color:#9ca3af; font-size:.78rem; line-height:1.45; padding:12px 16px; border-bottom:1px solid rgba(139,0,0,.22); background:rgba(255,255,255,.025); }
  @media(max-width:720px) {
    #rs-chat-fab { top:auto; right:18px; bottom:18px; width:54px; height:54px; }
    #rs-chat-drawer { width:100vw; }
  }
`;
document.head.appendChild(style);

}

function buildShell() {
if (document.getElementById('rs-chat-fab')) return;

injectStyles();

const fab = document.createElement('button');
fab.id = 'rs-chat-fab';
fab.type = 'button';
fab.title = 'Open chat';
fab.innerHTML = `${iconSvg()}<span class="rs-chat-pulse" aria-hidden="true"></span>`;
fab.addEventListener('click', openDrawer);

const shade = document.createElement('div');
shade.id = 'rs-chat-shade';
shade.addEventListener('click', closeDrawer);

const drawer = document.createElement('aside');
drawer.id = 'rs-chat-drawer';
drawer.setAttribute('aria-label', 'RS Fitness chat');
drawer.innerHTML = `
  <div class="rs-chat-head">
    <div>
      <div class="rs-chat-title">LIVE <span>CHAT</span></div>
      <div class="rs-chat-sub" id="rs-chat-sub">Coach-client messaging available anywhere in the app.</div>
    </div>
    <button class="rs-chat-close" type="button" id="rs-chat-close" aria-label="Close chat">Ã—</button>
  </div>
  <div class="rs-chat-notice" id="rs-chat-notice">Loading secure chat...</div>
  <div class="rs-chat-list" id="rs-chat-list"></div>
  <div class="rs-chat-messages" id="rs-chat-messages"><div class="rs-chat-empty">Open chat to start.</div></div>
  <div class="rs-chat-compose">
    <textarea id="rs-chat-input" placeholder="Type a message..." disabled></textarea>
    <button id="rs-chat-send" type="button" disabled>Send</button>
  </div>
`;

document.body.appendChild(fab);
document.body.appendChild(shade);
document.body.appendChild(drawer);

document.getElementById('rs-chat-close').addEventListener('click', closeDrawer);
document.getElementById('rs-chat-send').addEventListener('click', sendMessage);
document.getElementById('rs-chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

}

function setNotice(text, isError) {
const el = document.getElementById('rs-chat-notice');
if (!el) return;
el.textContent = text;
el.style.color = isError ? '#ff8c8c' : '#9ca3af';
}

function initial(name) {
return String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
}

function coachName(id) {
const coach = state.coaches.find(item => String(item.id) === String(id));
return coach?.full_name || coach?.username || 'Coach';
}

function senderName(id) {
const sender = state.senderProfiles[String(id)] || {};
if (String(id || '') === String(state.profile?.id || '')) return 'You';
return sender.full_name || sender.username || 'RS Fitness';
}

function formatTime(value) {
try {
return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
} catch {
return '';
}
}

function isMine(message) {
return String(message.sender_id || '') === String(state.profile?.id || '');
}

function canDelete(message) {
return !message.deleted_for_everyone && (isMine(message) || state.profile?.role === 'super_admin');
}

function renderList() {
const list = document.getElementById('rs-chat-list');
if (!list) return;

if (state.profile?.role === 'client') {
  list.innerHTML = '';
  return;
}

if (!state.allowedClients.length) {
  list.innerHTML = '<div class="rs-chat-empty">No assigned client chats yet.</div>';
  return;
}

list.innerHTML = state.allowedClients.map(client => {
  const active = state.selectedClient && String(state.selectedClient.id) === String(client.id) ? 'active' : '';
  const label = client.name || 'Client';
  const meta = client.coach_id ? `Coach: ${coachName(client.coach_id)}` : 'No coach assigned';
  return `
    <button class="rs-chat-list-btn ${active}" type="button" data-client-id="${pack(client.id)}">
      <div class="rs-chat-avatar">${esc(initial(label))}</div>
      <div>
        <div class="rs-chat-person">${esc(label)}</div>
        <div class="rs-chat-meta">${esc(meta)}</div>
      </div>
    </button>
  `;
}).join('');

list.querySelectorAll('[data-client-id]').forEach(button => {
  button.addEventListener('click', () => openClientChat(unpack(button.getAttribute('data-client-id'))));
});

}

function renderMessages(messages) {
const box = document.getElementById('rs-chat-messages');
if (!box) return;

if (!messages.length) {
  box.innerHTML = '<div class="rs-chat-empty">No messages yet. Start the conversation.</div>';
  return;
}

box.innerHTML = messages.map(message => {
  const mine = isMine(message) ? 'mine' : '';
  const deleted = message.deleted_for_everyone ? 'deleted' : '';
  const text = message.deleted_for_everyone ? 'This message was deleted.' : message.message_text;
  const deleteButton = canDelete(message)
    ? `<button class="rs-chat-delete" type="button" data-delete-id="${pack(message.id)}">Delete for both</button>`
    : '';

  return `
    <div class="rs-chat-row ${mine} ${deleted}">
      <div class="rs-chat-bubble">
        <div class="rs-chat-msg-top">
          <span class="rs-chat-sender">${esc(senderName(message.sender_id))}</span>
          <span class="rs-chat-time">${esc(formatTime(message.created_at))}</span>
        </div>
        <div class="rs-chat-text">${esc(text)}</div>
        ${deleteButton}
      </div>
    </div>
  `;
}).join('');

box.querySelectorAll('[data-delete-id]').forEach(button => {
  button.addEventListener('click', () => deleteMessage(unpack(button.getAttribute('data-delete-id'))));
});

box.scrollTop = box.scrollHeight;

}

async function loadCoaches() {
const rows = await window.rsAuth.dbSelect('profiles', 'select=id,full_name,username,role,is_active&order=full_name.asc');
state.coaches = rows.filter(p => p.is_active && (p.role === 'coach' || p.role === 'super_admin'));
}

async function loadAllowedClients() {
await loadCoaches();

if (state.profile.role === 'client') {
  const clientId = state.profile.client_id;
  if (!clientId) throw new Error('This account is not linked to a client record yet.');

  const client = await window.rsAuth.dbGet('clients', `id=eq.${encodeURIComponent(clientId)}&select=*`);
  if (!client) throw new Error('Your linked client record was not found.');
  if (!client.coach_id) throw new Error('No coach has been assigned yet. Chat unlocks once a coach is assigned.');

  state.allowedClients = [client];
  return;
}

const query = state.profile.role === 'coach'
  ? `coach_id=eq.${encodeURIComponent(state.profile.id)}&order=name.asc`
  : 'order=name.asc';

const rows = await window.rsAuth.dbSelect('clients', query);
state.allowedClients = rows.filter(client => state.profile.role === 'super_admin' ? !!client.coach_id : true);

}

async function ensureRealtimeClient() {
if (state.realtime) return state.realtime;

const session = sessionFromStorage();
if (!session?.access_token || !window.supabase) return null;

const client = window.supabase.createClient(getSupabaseUrl(), getSupabaseKey(), {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  realtime: { params: { eventsPerSecond: 10 } }
});

if (session.refresh_token) {
  try {
    await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  } catch (error) {
    console.warn('RS chat realtime session warning:', error);
  }
}

state.realtime = client;
return client;

}

async function bootChat() {
if (state.booted || state.loading) return;
state.loading = true;

try {
  await ensureDependencies();
  state.profile = await window.rsAuth.getCurrentProfile();
  if (!state.profile) {
    document.getElementById('rs-chat-fab')?.remove();
    document.getElementById('rs-chat-drawer')?.remove();
    document.getElementById('rs-chat-shade')?.remove();
    return;
  }

  await loadAllowedClients();
  await ensureRealtimeClient();
  renderList();

  if (state.profile.role === 'client') {
    const client = state.allowedClients[0];
    setNotice(`Chatting with ${coachName(client.coach_id)}.`, false);
    await openClientChat(client.id);
  } else {
    setNotice('Select a client conversation.', false);
    if (state.allowedClients.length) await openClientChat(state.allowedClients[0].id);
  }

  state.booted = true;
} catch (error) {
  console.error('RS chat widget error:', error);
  state.lastError = error.message || String(error);
  setNotice(state.lastError, true);
  document.getElementById('rs-chat-messages').innerHTML = '<div class="rs-chat-empty">Chat is unavailable. If this is first setup, run chat-schema.sql in Supabase.</div>';
} finally {
  state.loading = false;
}

}

async function openClientChat(clientId) {
const client = state.allowedClients.find(item => String(item.id) === String(clientId));
if (!client) return;

state.selectedClient = client;
state.conversation = null;
state.senderProfiles = {};
renderList();

const isClient = state.profile?.role === 'client';
const title = isClient ? coachName(client.coach_id) : (client.name || 'Client');
const sub = isClient ? 'Your assigned coach' : (client.coach_id ? `Coach: ${coachName(client.coach_id)}` : 'No coach assigned');
setNotice(`${title} Â· ${sub}`, false);
document.getElementById('rs-chat-messages').innerHTML = '<div class="rs-chat-empty">Opening secure chat...</div>';
document.getElementById('rs-chat-input').disabled = true;
document.getElementById('rs-chat-send').disabled = true;

try {
  const conversation = await window.rsAuth.dbRpc('get_or_create_chat_conversation', { target_client_id: client.id });
  state.conversation = Array.isArray(conversation) ? conversation[0] : conversation;
  if (!state.conversation?.id) throw new Error('Conversation was not created.');

  await loadMessages(true);
  await subscribeToConversation();
  document.getElementById('rs-chat-input').disabled = false;
  document.getElementById('rs-chat-send').disabled = false;
} catch (error) {
  console.error(error);
  setNotice(error.message || 'Could not open chat.', true);
  document.getElementById('rs-chat-messages').innerHTML = '<div class="rs-chat-empty">Could not open this chat.</div>';
}

}

async function loadMessages(scrollToBottom) {
if (!state.conversation?.id) return;

const messages = await window.rsAuth.dbSelect(
  'chat_messages',
  `conversation_id=eq.${encodeURIComponent(state.conversation.id)}&select=*&order=created_at.asc`
);

const ids = [...new Set(messages.map(msg => msg.sender_id).filter(Boolean).map(String))];
if (ids.length) {
  const profiles = await window.rsAuth.dbSelect('profiles', `id=in.(${ids.join(',')})&select=id,full_name,username,role`);
  state.senderProfiles = Object.fromEntries(profiles.map(profile => [String(profile.id), profile]));
}

renderMessages(messages);

if (scrollToBottom) {
  const box = document.getElementById('rs-chat-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

}

async function subscribeToConversation() {
const client = await ensureRealtimeClient();
if (!client || !state.conversation?.id) return;

if (state.channel) {
  try { await client.removeChannel(state.channel); } catch {}
  state.channel = null;
}

state.channel = client
  .channel(`rs-chat-widget-${state.conversation.id}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'chat_messages',
    filter: `conversation_id=eq.${state.conversation.id}`
  }, async () => {
    try { await loadMessages(true); } catch (error) { console.warn('Chat refresh failed:', error); }
  })
  .subscribe(status => {
    if (status === 'SUBSCRIBED') setNotice('Realtime chat connected.', false);
  });

}

async function sendMessage() {
const input = document.getElementById('rs-chat-input');
const text = input?.value.trim();
if (!text || !state.conversation?.id || !state.profile?.id) return;

document.getElementById('rs-chat-send').disabled = true;

try {
  await window.rsAuth.dbInsert('chat_messages', {
    conversation_id: state.conversation.id,
    sender_id: state.profile.id,
    message_text: text
  });

  input.value = '';
  await loadMessages(true);
} catch (error) {
  console.error(error);
  setNotice(error.message || 'Message failed to send.', true);
} finally {
  document.getElementById('rs-chat-send').disabled = false;
  input.focus();
}

}

async function deleteMessage(messageId) {
if (!messageId) return;
if (!confirm('Delete this message for both people?')) return;

try {
  await window.rsAuth.dbRpc('delete_chat_message_for_everyone', { target_message_id: messageId });
  await loadMessages(false);
} catch (error) {
  console.error(error);
  setNotice(error.message || 'Could not delete message.', true);
}

}

function openDrawer() {
state.isOpen = true;
document.body.classList.add('rs-chat-open');
bootChat();
}

function closeDrawer() {
state.isOpen = false;
document.body.classList.remove('rs-chat-open');
}

function start() {
const session = sessionFromStorage();
if (!session?.access_token) return;
buildShell();
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', start);
} else {
start();
}
})();

