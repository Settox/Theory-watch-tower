# The Forbidden Library

Constellation-themed idea map. Vanilla ES modules, no build step.

- `index.html` homepage, `app.html` the app (`app.html?room=name` for shared rooms; old `?room=` links on `index.html` redirect).
- Run locally: `python -m http.server 8742 --bind 127.0.0.1` in this folder.

## Accounts and rooms
- Sign in lives on the home page (email + password, Supabase Auth). Personal canvases stay on your device and never need an account.
- A room belongs to its owner. Who can enter is decided by the first rule that applies: a **whitelist** of emails (editor or viewer), else a **password** (separate editor and viewer passwords), else the room is **open** to anyone with its name. Rooms nobody owns are closed.
- The rules are enforced by the database (row-level security), not by the page. Files sit in a private Cloudflare R2 bucket behind a Worker that asks the database the same question.
- Node HTML is sanitized with DOMPurify on load, import, and from peers. Voice and AI keys stay in `localStorage` on your device.

## Highlights, import and clipper
- **Highlights in the book:** select text in a PDF/EPUB and a small bar offers four colours and a Star button. A highlighted star stays linked: recolour one and the other follows. Click a highlight (PDF) or open the Highlights list to add a note, recolour, or jump to its star.
- **Import:** Tools, Import highlights. Accepts Kindle `My Clippings.txt`, Readwise CSV, Markdown / Obsidian notes and Zotero note HTML (or just drop the file on the canvas). Each book becomes a gold star with its highlights around it.
- **Export:** Tools, Export to Markdown / Obsidian. A zip with one note per canvas (stars as headings, links as `[[wikilinks]]`) and one per book (highlights, notes, bookmarks).
- **Web clipper:** Tools, Web clipper. Drag the bookmarklet to your bookmarks bar; on a phone, install the app and use Share. Clips arrive as stars and nothing leaves your browser.

## Browser extension (Chrome, Edge, Brave)
1. Open `chrome://extensions`, turn on Developer mode, press **Load unpacked** and pick the `extension` folder.
2. Click the extension, open **Settings**, type the address where the app is published and press **Connect** (it asks permission for that one address only).
3. Open the app once. From then on the popup lists your canvases and rooms: pick the space (personal or a room), the canvas, then **Clip it**. Right-click on any page, link or selection also works and uses your last choice.

---

© 2026 Settox. All rights reserved. See [LICENSE](LICENSE).
