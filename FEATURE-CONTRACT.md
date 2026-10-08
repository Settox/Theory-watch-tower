# Feature contract (internal, shared by the feature agents; delete before release)

Project: **The Forbidden Library**, vanilla ES modules, no build, folder `C:\Users\setti\Desktop\J\Spazio teorie v2\`.
Static server already running: http://127.0.0.1:8742/app.html (python http.server). Hard-refresh / use `cache:'reload'` fetches if CSS looks stale.
Reply and comment in English. Terse modern JS matching the surrounding code, shortest working code, no speculative abstractions, no new dependencies except CDN scripts named in your task.

## Hard rules
- Edit ONLY the files your task lists (plus new files you create). Other agents are editing other files at the same time. If you need a change elsewhere, say so in your final report instead.
- NEVER open `?room=` URLs, never call real Supabase write APIs, never `localStorage.clear()`, never delete other people's data. For tests that need Supabase, monkeypatch `app.supabase` in the page with a fake.
- Security: never put user/remote text in `innerHTML` (use textContent / `h()` / `core.sanitize`). Treat all remote data (peer ops, published rows) as untrusted: validate types, clamp numbers, enums.
- Everything must work at 375px width and with touch. Respect `prefers-reduced-motion`.
- Respect `app.readonly` (core.js): when true, never mutate state (core.save() is already a no-op, but also hide/disable your editing UI).
- Constellation look: use CSS vars from css/theme.css (`--ink --ink2 --ink3 --line --line2 --star --dim --gold --cyan --rose --ok`, fonts `--serif --sans --mono`). Day theme exists (`html[data-theme=day]`); new themes (`html[data-sky=aurora|dawn|deep]`) may re-define vars, so never hard-code colours when a var fits.
- Verify your work in the browser pane (mcp__Claude_Browser__* tools: navigate, javascript_tool, read_console_messages, computer screenshot, resize_window; reset with preset desktop when done). The pane is small (~397px wide) unless you resize it. No console errors from your code.
- Final report under 150 words: files, what works, what you could not test.

## Module protocol
`js/main.js` loads modules in this order, calling `init(helpers)` on each that exists: themes, audio, library, voice, study, journey, argument, universe, tutorial, (collab), social. Missing modules are skipped.
`helpers = { showMenu(items,x,y), openModal((card, close)=>{...}), h(tag, props, ...kids), btn(text, fn, cls), pickFile(accept, cb), toggleLib(open), field(label,key,type,ph), slider(label,key,def,max,unit), toggle(label,key,def), select(label,key,[[value,label]],def) }`
- `showMenu` items: `{l:'Label', fn, danger?}` or `{sep:1}`.
- Add a Tools-menu + command-palette entry: `emit('register-tool', { label, key?, fn })` (call in init).
- Add a block to the Settings dialog: `emit('register-settings', (box, ui) => box.append(ui.h('p',{className:'mono',textContent:'Title'}), ui.toggle('Label','settingsKey',false), ui.slider(...), ui.select(...)))`. Settings live in `core.settings` (object persisted by `saveSettings()`); `emit('settings-changed',{key})` fires after toggle/select changes.

## core.js API (import from './core.js')
`$ uid clamp escapeHtml bus on emit toast sanitize settings saveSettings idb(put/get/del/keys; stores blobs,pdfs,tts,epubs,history) app(state,room,supabase,serverReady,readonly,mediaUrls) page() findNode(id) save() status(text) me() -> {id,name} (stable per browser) storeBlob mediaUrl uploadBlob downloadBlob copyText download loadScript cleanRoom loadLocal loadRoomFromServer normalizeState persistRoom writeRoom`
`app.state = {pages:[{id,name,nodes,connections,drawings,pubId?}], folders, volumes, current}`.
map.js exports: `view sel(Set of selected node ids) selConn pen PALETTE worldPos viewCenter applyView zoomAt fitAll focusNode(id) undo redo render refreshNode(id) addNode({x,y,w,h,title,body,source}) removeNodes(ids) insertImage embedVideo select(id) clearSel selNodes() setColor renderLinks addConnection(from,to,{kind?,color?}) removeConnection selectConn editLabel autoLayout renderDrawings setPen search switchPage(i) addPage deletePage loadView renderTabs drawMinimap`.

## Events (bus: `emit(name, detail)` / `on(name, fn)`)
Existing: `changed`, `live`, `state-replaced`, `library-render`, `open-source`(source obj), `read-volume`(id), `translate-volume`(id), `file-drop`({file}), `node-menu`({n,x,y}), `conn-menu`, `canvas-menu`, `prompt`({title,value,ok}), `confirm`({title,ok}), `comments`(nodeId), `tab-menu`, `add-media`(nodeId), `register-tool`, `register-settings`, `settings-changed`.
**New hooks already in map.js:** `node-rendered` ({n, el}: decorate a star's element after each render; el is `.node`, children `.node-head .node-body .node-src`), `link-created` ({from,to,kind}).
**New events defined by this contract:**
- `reader-pos` {volumeId, label, page?, cfi?}: emitted by PDF/EPUB readers whenever the reading position changes (throttled ~1s).
- `peer-reader` {id, name, hue, volumeId, label, page?, cfi?}: emitted by social.js when a peer's reading position arrives; readers show "Maria is on p. 34" chips (click = jump).
- `evidence` {nodeId}: ask the library/readers to open "evidence mode" for a star.
- `journey-event` {type:'open-volume'|'page'|'star'|'link'|'highlight', ...detail}: emitted by modules so journey.js can record.
- `activity` {text, who?, kind?}: social.js records entries for the activity feed (anyone can emit local ones).

## Data schema additions (all optional)
- node: `shape` ('circle'|'diamond'|'hex'|'star'|'rounded'|'note'), `icon` (emoji/short text ≤ 8 chars), `react` ({emoji: [userId, ...]}), `comments` (exists). Synced via collab FIELDS (already registered).
- connection: `kind` ('supports'|'contradicts'|'depends'|'relates'), synced.
- volume: `hl` (exists), `bm` ([{id, page|cfi, label, t}] bookmarks, synced).
- page: `pubId` (id of its published read-only snapshot), synced.
- NOT synced, per-user, stored in localStorage: reading progress (`st-prog` = {volumeId: {page|cfi, pct, t}}), study scheduling (`st-srs:<room|personal>` = {nodeId: {due, int, ease, reps}}).
- project-level `state.journeys` ([{id,name,steps:[...]}]) persisted with the project (not live-synced).
- room metadata (social.js owns): roles `{owner: userId, roles: {userId: 'editor'|'viewer'}, defaultRole}`. Roles are SOFT (client-enforced; document honestly that hard enforcement needs Supabase Auth + RLS).
- Published canvas = Supabase row in `spazio_teorie_projects` with `server_id = 'pub-' + <random 16+ char id>` and `state = {pages:[page copy], folders:[], volumes:[], journeys?}`; viewed at `app.html?view=<id>` (main.js already handles loading it read-only).

## Feature list by owner
A readers: reading progress + continue where you left off, dictionary/lookup, bookmarks, focus mode, reading-together UI, evidence mode, cross-book connections.
B map: custom star shapes/icons, universe view, argument maps (link kinds + analysis).
C learn: study mode (spaced repetition), reading journeys (record/replay/share), tutorial canvas.
D social: roles, presence, voting/reactions, activity feed, guest links, public canvases, reading-position transport.
E look: themes (aurora, deep space, dawn), sound & ambience (chimes on link, soft music; options in Settings).
