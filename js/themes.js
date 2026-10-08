// Sky themes (deep, aurora, dawn, ocean, ember, nebula, forest, void, sakura, solar). Safe on the homepage: applies the stored sky on import, touches no app DOM.
const SKIES = [['deep', 'Deep space', '#121842'], ['aurora', 'Aurora', '#0c6b5f'], ['dawn', 'Dawn', '#c9805f'], ['ocean', 'Ocean', '#0a7a96'], ['ember', 'Ember', '#c2410c'], ['nebula', 'Nebula', '#b83fb0'], ['forest', 'Forest', '#1d7a3a'], ['void', 'Void', '#222'], ['sakura', 'Sakura', '#c46a96'], ['solar', 'Solar', '#d9a010']];
const KEY = 'st-sky';
export function applySky(name) {
  if (!SKIES.some((s) => s[0] === name)) name = 'deep';
  document.documentElement.dataset.sky = name;
  try { localStorage.setItem(KEY, name); } catch {}
  return name;
}
let stored = 'deep'; try { stored = localStorage.getItem(KEY) || 'deep'; } catch {}
applySky(stored);
if (!document.querySelector('link[data-themes]')) { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('../css/themes.css', import.meta.url).href }); l.dataset.themes = 1; document.head.append(l); }

export async function init() {
  const { settings, saveSettings, on, emit } = await import('./core.js');
  settings.sky = applySky(settings.sky || stored);
  on('settings-changed', ({ key }) => { if (key === 'sky') applySky(settings.sky); });
  emit('register-settings', (box, ui) => {
    const sel = ui.select('Sky theme', 'sky', SKIES.map(([v, l]) => [v, l]), 'deep');
    const chips = ui.h('div', { className: 'sky-grid' }, ...SKIES.map(([v, l, c]) => ui.h('button', {
      type: 'button', title: l, 'aria-label': l, className: 'sky-chip' + (v === settings.sky ? ' on' : ''), textContent: l, style: `background:radial-gradient(circle at 50% 0,${c},#05060f)`,
      onclick(e) { settings.sky = v; saveSettings(); applySky(v); sel.querySelector('select').value = v; chips.querySelectorAll('.sky-chip').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); },
    })));
    box.append(ui.h('p', { className: 'mono', textContent: 'Sky & sound' }), sel, chips);
  });
}
