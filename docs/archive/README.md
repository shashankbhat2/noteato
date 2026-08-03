# Archived plans

Superseded by the revamp (`docs/revamp/`). Kept for the reasoning, not as direction — each of these
describes a product Noteato is no longer becoming. Read them as history.

| Document | Was | Superseded because |
|---|---|---|
| `roadmap-folders-sync-notion.md` | Folders, cross-device sync without auth, Notion migration, a hosted AI proxy | Its Phase 1 is folder support, which the revamp brief §11 explicitly forbids. The flat library shipped instead (commit `81bf02c`). |
| `plan-icloud-sync.md` | iCloud sync via a native macOS bridge | Sync moves to the paid tier in the revamp's §9 tiering, on a different architecture. |
| `tldraw-integration.md` | Canvas/drawing surface inside notes | Not in the revamp scope; §11's restraint argument applies. |

The Notion import described in `roadmap-folders-sync-notion.md` **did** ship and is live in
`src/main/notionImport.ts`. That part is not archived history.
