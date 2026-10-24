# Documents

A text editor with reading modes built in: reading mode (one sentence highlighted at a time), guided reading (speed reader that ramps from 400 wpm), notes after each paragraph saved to a Reading Journal, definitions, quick notes, PDF import and downloads. Save articles from Safari with a bookmark button.

Free to run: a static site on GitHub Pages. Everything you write is stored in your browser (IndexedDB) on that device.

## Files

| File | What it is |
|---|---|
| `index.html` | The app (originally a claude.ai artifact, copied as-is with three small edits: base styles, the bookmark button's return link, and a storage message). |
| `js/local-runtime.js` | Stands in for claude.ai's runtime: a local database with the same calls the app already makes, plus the **Data** button for backups. |
| `js/feedback.js` | The **Feedback** button: batch notes for fixes, each with a breadcrumb, copied as one prompt. |

## Run it locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Put it on GitHub Pages

1. Push this folder to a **public** GitHub repo (Pages is free for public repos; your documents never go to GitHub, only the app code).
2. Repo → Settings → Pages → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`.
3. Your app is at `https://<username>.github.io/<repo>/`. Open that URL in Safari from now on: browser storage belongs to that address.

## Save articles from Safari

**Mac:** in the app, click **+** beside the tabs → *Add a web article…* → drag **Send to Documents** to the Favorites bar (or use *Copy the bookmark code* and paste it as a bookmark's address). On any article, click the bookmark, switch to the app tab, click the page and press ⌘V.

**iPhone/iPad:** open *Add a web article…* in the app and tap *Copy the bookmark code*. Bookmark any page, then edit that bookmark: name it "Send to Documents" and paste the code as its address. On an article, tap the address bar, type "Send" and tap the bookmark; then switch to the app, tap the page and paste.

Signed in to a paywalled site? The bookmark reads the article from your own browser, so the full text you can see comes through. It's for your personal reading only.

## Feedback → fixes

1. Click **Feedback** (bottom left) → **Point at something**, or press **Ctrl+Option+F** anywhere, even in guided reading.
2. Click the button, panel or paragraph the note is about, choose Fix / Change / Idea, type the note, press **Ctrl+Enter** or **⌘Enter** (or click Add note).
   - **Selected text**: select words in a document first, then use this to quote them.
   - **General note**: for things not tied to one spot.
3. Repeat as you use the app. Notes are kept in this browser.
4. **Copy all** puts every open note on the clipboard as one numbered prompt. Each has a breadcrumb (mode › document › tab › section › panel › control), a CSS selector and a markup excerpt. Paste it into Claude Code in this repo.
5. **Mark sent** moves the batch to Sent so the next batch starts empty. Sent notes can be reopened or copied again.

## Your data

- Stored in this browser only; not synced between Mac and iPhone.
- **Data → Download a backup** saves a `.json` of everything. The button shows a red dot when it's been more than 7 days. Safari can clear storage for sites you haven't opened in a while, so back up weekly. Adding the site to your Home Screen (iPhone) or Dock (Mac) makes Safari keep it.
- **Data → Restore** loads a backup. It also accepts the `documents-backup.json` from the old claude.ai version's nightly backup.

## Not available in this version

These need a paid service or a Claude session, so their buttons are hidden: Ask Claude, comments sent to Claude, grammar check, AI definitions and summaries, Socratic questions, Open in Google Docs. The **listen voice** needs its model files (~100 MB) added under `voice/`; guided reading works without it.
