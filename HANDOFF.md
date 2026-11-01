# Documents tool: handoff (Oct 31, 2026)

## Where things live
- **claude.ai artifact (with AI features):** https://claude.ai/artifact/LC5azjuPx5FJkEFcU8dad1 — version 248. Its database and comment threads: https://claude.ai/code/artifact/9b69a46e-9815-44a4-a806-d72a1672b77c
- **Artifact source:** `artifact/documents-artifact.html` in this repo. This is the master copy; edit it, then republish the artifact from it.
- **GitHub web version (no AI):** `web/` — built from the same source. The claude.ai-only features (Ask Claude, shared database, summaries, audio) don't work there.

## Working rules (from Austin)
- In chat: if a request is unclear, ask first. If it's clear, say it back and wait for approval before changing anything.
- Ask Claude requests: queued = build behind an off switch, test, don't publish until "GO AHEAD"; implement now = build, test, publish. Unclear = mark "Pending clarification" with a question.
- Replies go in the chat as well as the request's thread.
- He voice-types; read for dictation slips.

## Live as of v248
- Option B side panel in Reading mode (faces and maps for the article; people named in 2+ paragraphs stay all article).
- Reading text 14 pt, 1.5 line spacing. Guided reading text 130%.
- "~N min left" estimate left of "% read" (pace over last 2 minutes); bar and labels at top.
- Explanation cards centered on their line; author faces marked (blue dashed ring, pen badge, "AUTHOR").
- Face lookup saves any face found and crops it square; up to 60 per load with photos script v1.3.

## Open items
- Austin needs to install photos script v1.3 in Tampermonkey (still on 1.2: 12 faces per load).
- People doc (one tab per person with picture and article bullets; pictures kept, refreshed if older than 14 days when a new article mentions them): approved, not built yet.
- Optional: make the Photo Desk add people from article text when Wikipedia rate-limits it (proposed, not approved).
- Morning tasks: Journalist 3:15, Manager 4:30 (calls the Substitute), Pundit 5:20, Photo Desk 5:25, Watchdog 5:45 (reruns failures, writes the "System log" doc).
