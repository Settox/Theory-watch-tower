// Shared by the popup and the background worker.
export const DEFAULT_APP = 'http://127.0.0.1:8742/';

export const load = () => chrome.storage.local.get({ app: DEFAULT_APP, lib: { pages: [], rooms: [] }, rooms: [], last: { space: 'personal', canvas: '' } });
export const cleanRoom = (r) => String(r || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// runs inside the page being clipped (must be self-contained)
export function grab() {
  const d = document, m = (n) => { const e = d.querySelector(`meta[property="${n}"],meta[name="${n}"]`); return (e && e.content) || ''; };
  return { t: (m('og:title') || d.title).slice(0, 200), u: location.href, q: String(getSelection()).trim().slice(0, 6000), d: (m('og:description') || m('description')).slice(0, 400) };
}

// dest: {space: 'personal' | 'room:<name>', canvas: '' (current) | 'new' | <canvas id>}
export function target(appUrl, dest, clip) {
  const u = new URL('app.html', appUrl.endsWith('/') ? appUrl : appUrl + '/');
  if (dest.space && dest.space.startsWith('room:')) u.searchParams.set('room', cleanRoom(dest.space.slice(5)));
  else if (dest.canvas === 'new') u.searchParams.set('new', '1');
  else if (dest.canvas) u.searchParams.set('page', dest.canvas);
  u.hash = 'clip=' + encodeURIComponent(JSON.stringify(clip));
  return u.href;
}
