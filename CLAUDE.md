# Documents app

A reading and note-taking app (editor, reading mode, guided reading, Reading Journal) served as a static site on GitHub Pages. No build step and no package manager: the files in this repo are exactly what ships.

## Files
- `index.html`: the whole app (HTML, CSS and one large script). It was written for claude.ai, so it reaches the outside world only through `window.claude.use(name)`.
- `js/local-runtime.js`: provides `window.claude.use('db' | 'user' | 'downloads')` on a plain web page: an IndexedDB store with a Firestore-like API, synced to Supabase when signed in. Also the bottom-left account/Data button and the sign-in screen.
- `js/claude-connect.js`: `claude.use('sample' | 'comments')` through the user's own Anthropic API key.
- `js/feedback.js`: the Feedback button (notes with breadcrumbs, Copy all, Send to GitHub).
- `js/config.js`: the Supabase project URL and publishable key. Leave it alone.
- `supabase/schema.sql`: the database table and row-level security rules.

## Rules for changes
- Match the code around you: same naming, terse style, comment density. Comments explain *why*, in plain words.
- Keep changes small and in place. Don't reformat, reorganize or "clean up" code you weren't asked to touch.
- It must work in Safari (Mac and iPhone) as well as Chrome. Avoid CSS or JS features Safari lacks (for example `field-sizing`), or add a fallback.
- When you change a file under `js/`, bump its `?v=` number in the `<script src>` tag in `index.html` so browsers fetch the new copy.
- External scripts load only from cdnjs.cloudflare.com, cdn.jsdelivr.net or unpkg.com, pinned to an exact version.
- Never put secrets in the repo. The Supabase publishable key in `js/config.js` is public by design.
- Feedback notes name an element by CSS selector and markup excerpt. Search `index.html` for the excerpt's id or class to find the code.

## Checking your work
Serve the folder and open it in a browser:

```bash
python3 -m http.server 8765
```

With no browser available, at least check that each `<script>` block in `index.html` still parses.
