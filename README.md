# The Forbidden Library

Constellation-themed idea map. Vanilla ES modules, no build step.

- `index.html` homepage, `app.html` the app (`app.html?room=name` for shared rooms; old `?room=` links on `index.html` redirect).
- Same Supabase table (`spazio_teorie_projects`) and bucket (`spazio-teorie-files`) as v1, so v1 rooms open here.
- Run locally: `python -m http.server` in this folder.

## Security notes
- Node HTML is sanitized with DOMPurify on load, import, and from peers.
- Anyone who knows a room name can edit it (no auth). Recommended: restrict RLS on `spazio_teorie_projects` and the bucket, and use hard-to-guess room names.
- API keys (voice/translation) stay in `localStorage` on your device.
