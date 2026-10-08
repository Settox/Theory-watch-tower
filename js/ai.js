// Shared AI client: Claude / Gemini / OpenAI-compatible chat, plus retry + rpm gate used by translate and tts.
export const DEFAULT_MODEL = { claude: 'claude-haiku-4-5-20251001', gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Error with .status, .retryMs (from Retry-After / retryDelay), .daily (quota gone for the day)
export async function httpErr(name, res) {
  let t = ''; try { t = await res.text(); } catch {}
  let msg = '';
  try { const j = JSON.parse(t), e = j.error || (Array.isArray(j) && j[0]?.error) || j; msg = e?.message || e?.status || (typeof e.detail === 'string' ? e.detail : e.detail?.message) || ''; } catch { msg = t.slice(0, 160); }
  const er = new Error(`${name}: error ${res.status}${msg ? ' - ' + String(msg).split('\n')[0].slice(0, 170) : ''}`);
  er.status = res.status;
  let ms = 0; const ra = res.headers?.get?.('retry-after');
  if (ra) { const s = parseFloat(ra); ms = isNaN(s) ? Math.max(0, Date.parse(ra) - Date.now()) : s * 1000; }
  const m = t.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) || t.match(/retry in ([\d.]+)\s*s/i);
  if (m) ms = Math.max(ms, parseFloat(m[1]) * 1000);
  er.retryMs = Math.min(ms, 180000);
  er.daily = res.status === 429 && /PerDay|per day|daily/i.test(t);
  return er;
}

// Retries network errors, 429 and 5xx with backoff (honours Retry-After). Everything else throws at once.
export async function retry(fn, { tries = 5, cancel = () => false, onWait } = {}) {
  for (let a = 0; ; a++) {
    if (cancel()) throw new Error('Cancelled');
    try { return await fn(); } catch (e) {
      const transient = e instanceof TypeError || e.status === 429 || e.status >= 500;
      if (!transient || e.daily || a >= tries - 1) throw e;
      const ms = (e.retryMs || Math.min(60000, 1500 * 2 ** a)) + Math.random() * 300;
      onWait?.(ms, a); await sleep(ms);
    }
  }
}

// Requests-per-minute limiter, one lane per id
const lane = {};
export async function gate(id, rpm, onWait) {
  const now = Date.now(), t = Math.max(now, lane[id] || 0);
  lane[id] = t + 60000 / Math.max(0.2, rpm || 15);
  if (t > now) { onWait?.(t - now); await sleep(t - now); }
}

// chat('claude'|'gemini'|'openai', key, model, prompt, {system, url}) -> text
export async function chat(provider, key, model, prompt, { system = '', url = '' } = {}) {
  model ||= DEFAULT_MODEL[provider];
  let r, j;
  if (provider === 'claude') {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model, max_tokens: 8192, system, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) throw await httpErr('Claude', r);
    j = await r.json(); return (j.content || []).map((x) => x.text || '').join('');
  }
  if (provider === 'gemini') {
    const gc = { temperature: 0.2, maxOutputTokens: 8192 };
    if (/2\.5/.test(model) && /flash/.test(model)) gc.thinkingConfig = { thinkingBudget: 0 };
    const safetySettings = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((c) => ({ category: 'HARM_CATEGORY_' + c, threshold: 'BLOCK_NONE' }));
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc, safetySettings }) });
    if (!r.ok) throw await httpErr('Gemini', r);
    j = await r.json();
    const out = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    if (!out) { const e = new Error('Gemini returned no text (' + (j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || 'empty') + ').'); e.fatal = true; throw e; }
    return out;
  }
  const base = (url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const h = { 'Content-Type': 'application/json' }; if (key) h.Authorization = 'Bearer ' + key;
  r = await fetch(base + '/chat/completions', { method: 'POST', headers: h, body: JSON.stringify({ model, temperature: 0.2, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] }) });
  if (!r.ok) throw await httpErr('OpenAI-compatible', r);
  j = await r.json(); return j.choices?.[0]?.message?.content || '';
}
