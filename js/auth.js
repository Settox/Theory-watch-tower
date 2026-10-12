// Accounts: Supabase Auth with email + password. Personal canvases never need an account.
// The sign-in form lives ONLY on the home page. The app just reads the session; when it needs a login (a private room
// the room needs it) it sends you to the home page and brings you back afterwards.
import { app, emit, toast, status } from './core.js';

let H, btnEl, readyRes;
export const ready = new Promise((r) => { readyRes = r; });
const auth = () => app.supabase?.auth;
const nameOf = (u) => ((u?.user_metadata?.display_name || '').trim() || (u?.email || '').split('@')[0] || 'Account');
const friendly = (m) => (/invalid login credentials/i.test(m) ? 'That email and password do not match.' : /already registered/i.test(m) ? 'There is already an account with this email. Sign in instead.' : m);
const homeUrl = () => new URL('index.html', location.href);

/* tiny helpers for the home page (the app passes its own, same shape) */
function homeHelpers() {
  const modal = document.getElementById('modal');
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const btn = (t, fn, cls = '') => h('button', { className: 'btn ' + cls, textContent: t, onclick: fn, type: 'button' });
  const openModal = (build) => {
    modal.textContent = ''; const card = h('div', { className: 'card' }); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); modal.append(card);
    const close = () => { modal.hidden = true; modal.textContent = ''; }; build(card, close);
    modal.hidden = false; modal.onclick = (e) => { if (e.target === modal) close(); }; (card.querySelector('input') || card).focus?.();
    return close;
  };
  return { h, btn, openModal };
}

/* ---------- sign-in UI (home page only) ---------- */
function toHome(why) { // the app needs a login: go to the home page, which brings you back here
  const back = location.pathname.split('/').pop() + location.search + location.hash;
  const u = homeUrl(); u.searchParams.set('signin', '1'); u.searchParams.set('next', back); if (why) u.searchParams.set('why', why);
  location.href = u.href;
}
export function openAuth(mode = 'in', why = '') {
  if (!auth()) return toast('Accounts are not available (no server configured).');
  if (!btnEl) return toHome(why); // not on the home page
  if (app.user) return openAccount();
  H.openModal((card, close) => {
    const up = mode === 'up', reset = mode === 'reset';
    const name = H.h('input', { type: 'text', placeholder: 'Your name', autocomplete: 'nickname', maxLength: 40 });
    const email = H.h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
    const pass = H.h('input', { type: 'password', placeholder: up ? 'At least 8 characters' : 'Password', autocomplete: up ? 'new-password' : 'current-password', minLength: 8 });
    const msg = H.h('p', { className: 'hint', role: 'status' });
    const say = (t) => { msg.textContent = t; };
    const go = H.btn(reset ? 'Send reset link' : up ? 'Create account' : 'Sign in', async () => {
      const e = email.value.trim();
      if (!e) return say('Enter your email.');
      if (!reset && pass.value.length < 8) return say('The password needs at least 8 characters.');
      go.disabled = true; say('One moment…');
      try {
        const A = auth(), back = location.origin + location.pathname + location.search;
        if (reset) {
          const { error } = await A.resetPasswordForEmail(e, { redirectTo: back });
          say(error ? friendly(error.message) : 'If that email has an account, a reset link is on its way.');
        } else if (up) {
          const { data, error } = await A.signUp({ email: e, password: pass.value, options: { data: { display_name: name.value.trim() }, emailRedirectTo: back } });
          if (error) say(friendly(error.message));
          else if (data.session) { close(); toast('Account created. You are signed in.'); }
          else say('Almost there: open the confirmation email we just sent, then come back and sign in.');
        } else {
          const { error } = await A.signInWithPassword({ email: e, password: pass.value });
          if (error) say(friendly(error.message)); else { close(); toast('Signed in.'); }
        }
      } catch (err) { say('Could not reach the server. Check your connection and try again.'); }
      go.disabled = false;
    }, 'primary auth-go');
    const text = (label, m) => H.h('button', { type: 'button', className: 'auth-link', textContent: label, onclick: () => { close(); openAuth(m, why); } });
    const title = reset ? 'Reset your password' : up ? 'Create your account' : 'Welcome back';
    const sub = reset ? 'Enter your email and we will send you a link to choose a new password.' : up ? 'One account for your rooms and invitations.' : 'Sign in to open your rooms and accept invitations.';
    pass.onkeydown = email.onkeydown = name.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
    card.append(
      H.h('div', { className: 'auth-head' }, H.h('span', { className: 'auth-star', textContent: '✦', ariaHidden: 'true' }), H.h('h2', { className: 'serif', textContent: title }), H.h('p', { className: 'auth-sub', textContent: sub })),
      why ? H.h('p', { className: 'auth-why', textContent: why }) : '',
      up ? H.h('label', { textContent: 'Name' }, name) : '',
      H.h('label', { textContent: 'Email' }, email),
      reset ? '' : H.h('label', { textContent: 'Password' }, pass),
      msg,
      go,
      H.h('div', { className: 'auth-links' },
        mode === 'in' ? text('Forgot your password?', 'reset') : '',
        up ? H.h('span', { className: 'auth-alt' }, 'Already have an account? ', text('Sign in', 'in'))
          : reset ? text('Back to sign in', 'in')
          : H.h('span', { className: 'auth-alt' }, 'New here? ', text('Create an account', 'up'))),
      H.h('p', { className: 'auth-note', textContent: 'Your personal canvases stay on this device and never need an account. An account is for rooms: owning them and inviting people to them.' }));
    email.focus();
  });
}

function openAccount() {
  H.openModal((card, close) => {
    const name = H.h('input', { type: 'text', value: app.user.user_metadata?.display_name || '', maxLength: 40, placeholder: 'Your name' });
    const msg = H.h('p', { className: 'hint', role: 'status' });
    card.append(
      H.h('h2', { className: 'serif', textContent: 'Your account' }),
      H.h('p', { textContent: app.user.email }),
      H.h('label', { textContent: 'Name shown in rooms' }, name),
      msg,
      H.h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between' },
        H.h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          H.btn('Sign out', async () => { await auth().signOut(); close(); toast('Signed out.'); }),
          H.btn('Change password', () => { close(); passwordModal(); })),
        H.btn('Save name', async () => { const { error } = await auth().updateUser({ data: { display_name: name.value.trim() } }); msg.textContent = error ? friendly(error.message) : 'Saved.'; paint(); }, 'primary')));
  });
}

function passwordModal() {
  H.openModal((card, close) => {
    const pass = H.h('input', { type: 'password', autocomplete: 'new-password', minLength: 8, placeholder: 'At least 8 characters' });
    const msg = H.h('p', { className: 'hint', role: 'status' });
    card.append(H.h('h2', { className: 'serif', textContent: 'Choose a new password' }), H.h('label', { textContent: 'New password' }, pass), msg,
      H.h('div', { style: 'display:flex;justify-content:flex-end' }, H.btn('Save password', async () => {
        if (pass.value.length < 8) { msg.textContent = 'The password needs at least 8 characters.'; return; }
        const { error } = await auth().updateUser({ password: pass.value });
        if (error) msg.textContent = friendly(error.message); else { close(); toast('Password updated.'); }
      }, 'primary')));
    pass.focus();
  });
}

function paint() {
  if (!btnEl) return;
  btnEl.textContent = app.user ? nameOf(app.user) : 'Sign in';
  btnEl.title = app.user ? `Signed in as ${app.user.email}` : 'Sign in or create an account';
}

/* ---------- rooms: access and invites (used by the app) ---------- */
export async function roomAccess(room) { // 'none' | 'legacy' | 'owner' | 'editor' | 'viewer' | 'denied' | null (could not tell)
  try { const { data, error } = await app.supabase.rpc('spazio_room_access', { p_room: room }); return error ? null : data; } catch { return null; }
}
export async function joinWithPassword(room, password) { // -> { ok, role, error }
  try {
    const { data, error } = await app.supabase.rpc('spazio_join_with_password', { p_room: room, p_password: password });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: 'No answer from the server.' };
  } catch { return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; }
}
/* signed in, but not a member: ask for the room's password (editor or viewer password decides the role) */
export function showJoin(room) {
  status('Password needed · ' + room);
  H.openModal((card) => {
    const pass = H.h('input', { type: 'password', placeholder: 'Room password', autocomplete: 'off' });
    const msg = H.h('p', { className: 'hint', role: 'status' });
    const go = H.btn('Join room', async () => {
      if (!pass.value) { msg.textContent = 'Enter the room password.'; return; }
      go.disabled = true; msg.textContent = 'One moment…';
      const r = await joinWithPassword(room, pass.value);
      if (r.ok) { msg.textContent = `Joined as ${r.role}.`; location.reload(); } else { msg.textContent = r.error || 'Could not join.'; go.disabled = false; pass.select(); }
    }, 'primary');
    pass.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
    card.append(
      H.h('div', { className: 'auth-head' }, H.h('span', { className: 'auth-star', textContent: '✦' }), H.h('h2', { className: 'serif', textContent: 'This room is private' }),
        H.h('p', { className: 'auth-sub', textContent: `Enter the password for “${room}”. Ask the room's owner if you don't have it.` })),
      H.h('label', { textContent: 'Password' }, pass), msg, go,
      H.h('div', { className: 'auth-links' }, H.h('button', { type: 'button', className: 'auth-link', textContent: 'Back to my canvases', onclick: () => { location.href = 'app.html'; } })));
    pass.focus();
  });
}
export function showDenied(room, kind = 'whitelist') {
  status('No access · ' + room);
  H.openModal((card) => card.append(
    H.h('div', { className: 'auth-head' }, H.h('span', { className: 'auth-star', textContent: '✦' }),
      H.h('h2', { className: 'serif', textContent: kind === 'legacy' ? 'This room is archived' : 'This room is private' }),
      H.h('p', { className: 'auth-sub', textContent: kind === 'legacy'
        ? `“${room}” was created before accounts and has no owner yet, so it is closed. Its owner can claim it.`
        : `“${room}” is only open to the people its owner has listed. You are signed in as ${app.user?.email || 'this account'}. Ask the owner to add that address.` })),
    H.h('div', { className: 'auth-links' }, H.h('button', { type: 'button', className: 'auth-link', textContent: 'Back to my canvases', onclick: () => { location.href = 'app.html'; } }))));
}

/* ---------- boot: the app (session only, no sign-in UI) ---------- */
export function init(helpers) {
  H = helpers;
  if (!app.serverReady || !auth()) { readyRes(); return; }
  auth().getSession().then(({ data }) => { app.user = data.session?.user || null; emit('auth', app.user); }).catch(() => {}).finally(readyRes);
  auth().onAuthStateChange((ev, session) => { app.user = session?.user || null; emit('auth', app.user); });
}

/* ---------- boot: the home page (the one place with the sign-in form) ---------- */
const announce = () => dispatchEvent(new CustomEvent('st-user', { detail: app.user ? { email: app.user.email, confirmed: !!app.user.email_confirmed_at } : null }));
export function initHome(button) {
  btnEl = button; H = homeHelpers();
  if (!app.serverReady || !auth()) { button.hidden = true; return; }
  button.onclick = () => openAuth();
  const P = new URLSearchParams(location.search);
  const next = P.get('next');
  const safeNext = next && /^[a-zA-Z0-9._-]+\.html([?#].*)?$/.test(next) ? next : ''; // only back into this site's own pages
  const finish = (user) => { if (user && safeNext) location.href = safeNext; };
  auth().getSession().then(({ data }) => {
    app.user = data.session?.user || null; paint(); announce();
    if (P.get('signin')) {
      if (app.user) return finish(app.user);
      history.replaceState(null, '', location.pathname + location.hash);
      openAuth('in', P.get('why') || '');
    }
  }).catch(() => {});
  auth().onAuthStateChange((ev, session) => {
    const was = app.user; app.user = session?.user || null; paint(); announce();
    if (ev === 'PASSWORD_RECOVERY') passwordModal();
    if (ev === 'SIGNED_IN' && !was) finish(app.user);
  });
}
