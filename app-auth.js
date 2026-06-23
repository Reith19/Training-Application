const RS_SUPABASE_URL = 'https://usmeoqyzlnxnoighhiga.supabase.co';
const RS_SUPABASE_KEY = 'sb_publishable_r5uttSQDB3twbwYYN5-EMg_57_GPPXO';

const RS_SESSION_KEY = 'rs_auth_session';
const RS_PROFILE_KEY = 'rs_auth_profile';

function rsAnonHeaders(extra = {}) {
return {
'Content-Type': 'application/json',
'apikey': RS_SUPABASE_KEY,
'Authorization': `Bearer ${RS_SUPABASE_KEY}`,
...extra
};
}

function rsGetSession() {
try {
return JSON.parse(localStorage.getItem(RS_SESSION_KEY) || 'null');
} catch {
return null;
}
}

function rsSetSession(session) {
localStorage.setItem(RS_SESSION_KEY, JSON.stringify(session));
}

function rsGetStoredProfile() {
try {
return JSON.parse(localStorage.getItem(RS_PROFILE_KEY) || 'null');
} catch {
return null;
}
}

function rsSetProfile(profile) {
localStorage.setItem(RS_PROFILE_KEY, JSON.stringify(profile));
}

function rsClearAuth() {
localStorage.removeItem(RS_SESSION_KEY);
localStorage.removeItem(RS_PROFILE_KEY);
}

function rsCurrentUserId() {
const session = rsGetSession();
return session?.user?.id || null;
}

function rsDecodeJwtPayload(token) {
try {
const payload = token.split('.')[1];
if (!payload) return null;

```
const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');

return JSON.parse(atob(padded));
```

} catch {
return null;
}
}

function rsTokenExpiresSoon(token, bufferSeconds = 60) {
const payload = rsDecodeJwtPayload(token || '');

if (!payload?.exp) return false;

const nowSeconds = Math.floor(Date.now() / 1000);

return payload.exp <= nowSeconds + bufferSeconds;
}

function rsAuthHeaders(extra = {}) {
const session = rsGetSession();
const token = session?.access_token || RS_SUPABASE_KEY;

return {
'Content-Type': 'application/json',
'apikey': RS_SUPABASE_KEY,
'Authorization': `Bearer ${token}`,
...extra
};
}

async function rsRefreshSession() {
const session = rsGetSession();

if (!session?.refresh_token) {
return session;
}

const res = await fetch(`${RS_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
method: 'POST',
headers: rsAnonHeaders(),
body: JSON.stringify({
refresh_token: session.refresh_token
})
});

const data = await res.json().catch(() => ({}));

if (!res.ok) {
rsClearAuth();
throw new Error(data.error_description || data.msg || data.message || 'Login expired. Please log in again.');
}

const nextSession = {
...session,
...data,
user: data.user || session.user
};

rsSetSession(nextSession);

return nextSession;
}

async function rsEnsureFreshSession(force = false) {
const session = rsGetSession();

if (!session?.access_token) {
return null;
}

if (force || rsTokenExpiresSoon(session.access_token)) {
return await rsRefreshSession();
}

return session;
}

function rsIsJwtExpiredResponse(status, data) {
const raw = typeof data === 'string' ? data : JSON.stringify(data || {});

return (
status === 401 ||
raw.includes('JWT expired') ||
raw.includes('PGRST303') ||
raw.includes('invalid JWT')
);
}

async function rsFetchJson(path, options = {}, retry = true) {
await rsEnsureFreshSession(false);

const res = await fetch(`${RS_SUPABASE_URL}${path}`, {
...options,
headers: {
...rsAuthHeaders(),
...(options.headers || {})
}
});

const text = await res.text();
let data = null;

try {
data = text ? JSON.parse(text) : null;
} catch {
data = text;
}

if (!res.ok && retry && rsIsJwtExpiredResponse(res.status, data)) {
await rsEnsureFreshSession(true);
return rsFetchJson(path, options, false);
}

if (!res.ok) {
const message =
data?.message ||
data?.details ||
data?.error_description ||
data?.msg ||
(typeof data === 'string' ? data : JSON.stringify(data));

```
throw new Error(message || 'Request failed.');
```

}

return data;
}

async function rsSignIn(email, password) {
const res = await fetch(`${RS_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
method: 'POST',
headers: rsAnonHeaders(),
body: JSON.stringify({
email,
password
})
});

const data = await res.json().catch(() => ({}));

if (!res.ok) {
throw new Error(data.error_description || data.msg || data.message || 'Login failed.');
}

rsSetSession(data);

const profile = await rsFetchMyProfile();

if (!profile?.is_active) {
rsClearAuth();
throw new Error('This account is inactive.');
}

rsSetProfile(profile);

return {
session: data,
profile
};
}

async function rsFetchMyProfile() {
const uid = rsCurrentUserId();

if (!uid) {
throw new Error('No active login session.');
}

const data = await rsFetchJson(
`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=*`,
{ method: 'GET' }
);

const profile = Array.isArray(data) ? data[0] : null;

if (!profile) {
throw new Error('Login worked, but this user has no profile/role yet. Create a profile in Settings or first-admin setup.');
}

return profile;
}

async function rsGetCurrentProfile() {
const session = await rsEnsureFreshSession(false);

if (!session?.access_token) {
return null;
}

const storedProfile = rsGetStoredProfile();

if (storedProfile?.id === session?.user?.id) {
return storedProfile;
}

const profile = await rsFetchMyProfile();
rsSetProfile(profile);

return profile;
}

function rsIsAdminRole(role) {
return role === 'super_admin' || role === 'coach';
}

async function rsRequireRoles(allowedRoles = []) {
let profile = null;

try {
profile = await rsGetCurrentProfile();
} catch {
rsClearAuth();
window.location.href = 'index.html';
return null;
}

if (!profile) {
window.location.href = 'index.html';
return null;
}

if (!profile.is_active) {
rsClearAuth();
window.location.href = 'index.html';
return null;
}

if (allowedRoles.length && !allowedRoles.includes(profile.role)) {
window.location.href = rsHomeFor(profile);
return null;
}

return profile;
}

function rsHomeFor(profile) {
return 'home.html';
}

async function rsSignOut() {
const session = rsGetSession();

try {
if (session?.access_token) {
await fetch(`${RS_SUPABASE_URL}/auth/v1/logout`, {
method: 'POST',
headers: rsAuthHeaders()
});
}
} catch {}

rsClearAuth();
window.location.href = 'index.html';
}

async function rsDbSelect(table, query = '') {
const data = await rsFetchJson(`/rest/v1/${table}?${query}`, {
method: 'GET'
});

return Array.isArray(data) ? data : [];
}

async function rsDbGet(table, query = '') {
const rows = await rsDbSelect(table, query);

return rows[0] || null;
}

async function rsDbInsert(table, payload) {
const data = await rsFetchJson(`/rest/v1/${table}`, {
method: 'POST',
headers: {
'Prefer': 'return=representation'
},
body: JSON.stringify(payload)
});

return Array.isArray(data) ? data[0] : data;
}

async function rsDbPatch(table, filter, payload) {
const data = await rsFetchJson(`/rest/v1/${table}?${filter}`, {
method: 'PATCH',
headers: {
'Prefer': 'return=representation'
},
body: JSON.stringify(payload)
});

return Array.isArray(data) ? data[0] : data;
}

async function rsDbDelete(table, filter) {
await rsFetchJson(`/rest/v1/${table}?${filter}`, {
method: 'DELETE'
});

return true;
}

async function rsDbRpc(functionName, payload = {}) {
return await rsFetchJson(`/rest/v1/rpc/${functionName}`, {
method: 'POST',
body: JSON.stringify(payload)
});
}

async function rsCreateAuthUser(email, password) {
const res = await fetch(`${RS_SUPABASE_URL}/auth/v1/signup`, {
method: 'POST',
headers: rsAnonHeaders(),
body: JSON.stringify({
email,
password
})
});

const data = await res.json().catch(() => ({}));

if (!res.ok) {
throw new Error(data.error_description || data.msg || data.message || JSON.stringify(data));
}

const user =
data.user ||
data.session?.user ||
data;

if (!user?.id) {
throw new Error('Auth signup succeeded, but no user ID was returned. Check Supabase Authentication > Users, then create the profile manually from auth.users.');
}

return user;
}

async function rsGetAssignedClientIds(coachId = null) {
const profile = await rsGetCurrentProfile();
const id = coachId || profile?.id;

if (!id) {
return [];
}

const rows = await rsDbSelect(
'coach_clients',
`coach_id=eq.${encodeURIComponent(id)}&select=client_id`
);

return rows.map(row => row.client_id).filter(Boolean);
}

async function rsCanAccessClient(clientId, profile = null) {
if (!clientId) {
return false;
}

const p = profile || await rsGetCurrentProfile();

if (!p || !p.is_active) {
return false;
}

if (p.role === 'super_admin') {
return true;
}

if (p.role === 'client') {
return String(p.client_id || '') === String(clientId);
}

if (p.role === 'coach') {
const assignedIds = await rsGetAssignedClientIds(p.id);
return assignedIds.map(String).includes(String(clientId));
}

return false;
}

async function rsRequireClientAccess(clientId, allowedRoles = ['super_admin', 'coach', 'client']) {
const profile = await rsRequireRoles(allowedRoles);

if (!profile) {
return null;
}

const ok = await rsCanAccessClient(clientId, profile);

if (ok) {
return profile;
}

rsToast('You do not have access to this client.', 'error');

if (profile.role === 'client' && profile.client_id) {
window.location.href = `client-profile.html?id=${encodeURIComponent(profile.client_id)}`;
} else {
window.location.href = 'clients.html';
}

return null;
}

function rsToast(message, type = 'success') {
let toast = document.getElementById('toast');

if (!toast) {
toast = document.createElement('div');
toast.id = 'toast';
toast.style.cssText = `       position: fixed;
      right: 24px;
      bottom: 24px;
      background: #1a1a1a;
      border: 1px solid rgba(139,0,0,.4);
      color: white;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: .85rem;
      z-index: 999;
      opacity: 0;
      transform: translateY(10px);
      transition: .3s;
      max-width: 360px;
      line-height: 1.4;
    `;
document.body.appendChild(toast);
}

toast.textContent = message;
toast.style.opacity = '1';
toast.style.transform = 'translateY(0)';
toast.style.borderColor = type === 'error' ? '#cc0000' : '#00c864';
toast.style.color = type === 'error' ? '#ff6b6b' : '#00c864';

setTimeout(() => {
toast.style.opacity = '0';
toast.style.transform = 'translateY(10px)';
}, 3500);
}

window.rsAuth = {
signIn: rsSignIn,
signOut: rsSignOut,
requireRoles: rsRequireRoles,
requireClientAccess: rsRequireClientAccess,
canAccessClient: rsCanAccessClient,
getAssignedClientIds: rsGetAssignedClientIds,
getCurrentProfile: rsGetCurrentProfile,
getStoredProfile: rsGetStoredProfile,
dbSelect: rsDbSelect,
dbGet: rsDbGet,
dbInsert: rsDbInsert,
dbPatch: rsDbPatch,
dbDelete: rsDbDelete,
dbRpc: rsDbRpc,
createAuthUser: rsCreateAuthUser,
isAdminRole: rsIsAdminRole,
homeFor: rsHomeFor,
toast: rsToast,
clear: rsClearAuth
};
