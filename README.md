<p align="center">
  <img src="build/icon.png" width="96" alt="Noteato icon" />
</p>

<h1 align="center">Noteato</h1>

<p align="center">A minimal, block-based note taking app for Mac. Markdown, search, dictation, side-by-side panes, reminders, and optional AI — all local, nothing behind an account.</p>

<p align="center">
  <a href="https://github.com/shashankbhat2/noat/actions/workflows/ci.yml"><img src="https://github.com/shashankbhat2/noat/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/shashankbhat2/noat/releases/latest"><img src="https://img.shields.io/github/v/release/shashankbhat2/noat" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

## Why

Notion is a great tool that happens to also be a browser tab pretending to be an app: a web renderer, a sync engine, a database, a workspace/permissions model, and a note editor, all bundled together, for people who just want to write something down. Noteato is the opposite bet. Blocks and markdown for writing, one flat list and search for finding things again, dictation for when typing is slower than talking, panes for reading one note while writing another, reminders for the stuff you'd otherwise forget, and AI that's entirely optional and bring-your-own-key — nothing routes through a Noteato server. Everything lives on your disk as plain `.md` files, not behind an account.

<p align="center">
  <img src="ss/editor.png" width="100%" alt="Noteato editor with the sidebar, recent notes, folders, and a focused writing surface" />
</p>

## Features

### Writing

- **Blocks, not a textarea** — slash menu, headings, to-dos, nesting, tables, etc. ([BlockNote](https://www.blocknotejs.org/))
- **Plain markdown mode** — flip any note to a raw markdown textarea and back, in place.
- **Notion-style block menu** on the drag handle — turn into, duplicate, copy, delete.
- **Note links** — type `@` to mention another note; opens it in the focused pane, and keeps pointing at the right note even after it's renamed.
- **Per-note full-width toggle**, a collapsible sidebar (`⌘\`), four fonts, and six accent colors.

<p align="center">
  <img src="ss/blocks.png" width="100%" alt="Noteato slash menu with block types and keyboard shortcuts" />
  <br />
  <sub>Build a note with blocks.</sub>
</p>


### Organization

- **One flat list, no folders** — notes sort by when you last touched them, and search does the finding. Upgrading from an older version flattens the library once, keeping a restorable copy of the old tree in the trash.
- **Up to three panes** side by side, each holding a note, Home, Trash or the assistant. ⌘-click a note (or drag it to the working area's edge) to open one beside what you're reading; drag the seam to resize. **Pin a pane** to hold its note in place while you browse others around it.
- **Full-text search** (`⌘K`) across every note, including `#tag` filters.
- **Favourites** at the top of the sidebar, inline rename, and undoable delete.
- **Reminders** — set a one-time date/time reminder on any note from the editor toolbar or the sidebar's right-click menu, with quick presets or a custom picker. Fires a native notification even if the note isn't open; clicking it opens the note. A reminder that passes while the app is closed surfaces as a catch-up notification on the next launch.

### AI (optional, bring your own key)

- **One floating panel** for the whole window, holding dictation and the note-level AI. Its subject is whichever note pane has focus, and it names that note — move between panes and the context moves with you.
- **Enhance** — Summarize, Key points, Improve writing, Proofread. One result, with Copy and Insert.
- **Ask** — a conversation about the focused note, threaded per note, so switching away and back returns you to where you left off.
- **Enhance selected text** — the same actions in place from the selection bubble menu, streamed into the note with Copy/Insert/Replace controls.
- Anthropic or OpenAI, your key, stored locally. No Noteato backend sits between the app and the provider, and every AI feature is off by default.

### Voice & quick capture

- **Dictation** — hit the mic in the floating panel and talk; [Deepgram Nova-3](https://deepgram.com/) streams your words directly into the open note. Say “scratch that” or “undo that” to remove the last dictated phrase. Bring your own API key.
- **Compact side panel** (`⌘⌥S`) — a narrow always-on-top window for quick capture and reminders, separate from your markdown library. Rest the pointer against the screen edge to reveal it; click away to dismiss. Which edge, and how long the pointer has to rest, are both settings.

<p align="center">
  <img src="ss/dictation.png" width="100%" alt="Live dictation writing directly into a Noteato note" />
</p>

### Files and everything else

- **Markdown on disk** — every note is a plain `.md` file with a small frontmatter header. No database, no export step, no lock-in. Sync it with iCloud/Dropbox/git if you want.
- **Import Markdown** (`⌘O`), and the OS recognizes Noteato as a Markdown editor — double-clicking a `.md` file in Finder opens it directly.
- **No tabs.** A pane shows one thing, with its own move, pin and close controls in its header — nothing to tidy up between sessions.
- **Light/dark/system theme**, matched to the actual window chrome, not just the page background.
- Window size and position persist across restarts, including maximized state.
- **Shortcuts** — `⌘T` new note, `⌘O` import markdown, `⌘K` find in notes, `⌘F` find in note, `⌘W` close pane, `⌘\` toggle sidebar, `⌘⌥S` compact side panel, `⌘,` settings.

No telemetry, no accounts, no auto-updater phoning home. It's an Electron app, so it isn't the smallest possible binary on disk, but there's nothing running that you didn't ask for.

## Install

Grab the latest `.dmg` from [Releases](https://github.com/shashankbhat2/noat/releases/latest), open it, and drag **Noteato.app** into **Applications**:

- `arm64` is for Apple Silicon Macs (M1 and newer).
- `x64` is for Intel Macs.

### About the Gatekeeper warning

This app isn't signed with an Apple Developer ID (that costs $99/year, and this is a free side project) or notarized by Apple. On first launch, macOS Gatekeeper will block it — and depending on your macOS version you'll see one of two dialogs:

- **"Noteato can't be opened because it is from an unidentified developer."** — right-click (Control-click) **Noteato.app** in Applications, choose **Open**, then click **Open** again in the dialog. macOS remembers this choice from then on.
- **"Noteato is damaged and should be moved to the Trash."** — this is Gatekeeper being stricter (common on Apple Silicon), and it does **not** offer an "Open anyway" option, so right-click → Open won't help here. Instead, strip the quarantine flag it added on download:

  ```bash
  xattr -cr /Applications/Noteato.app
  ```

  The app isn't actually damaged — this message is just what unsigned + quarantined apps get on newer macOS. Run the command above, then open it normally.

This is the standard tradeoff for unsigned open-source Mac apps — you're trusting the build, not Apple's notarization service. Check the [Releases](https://github.com/shashankbhat2/noat/releases) page for the commit each build was made from if you want to verify it yourself, or build from source below.

### Dictation setup

Dictation needs a [Deepgram](https://deepgram.com/) API key (their free tier covers casual use; Nova-3 streaming is about $0.0056/min beyond that). Open **Settings** (`⌘,`) inside Noteato and paste your key in — it's stored locally in the app's settings file, never sent anywhere but Deepgram.

### AI setup (optional)

The Enhance, Ask-note, and Agent features are off until you add a key. Open **Settings** (`⌘,`) → **AI**, pick Anthropic or OpenAI, and paste in your API key — it's stored locally and used only to call that provider directly. Skip this entirely and Noteato works exactly the same without it.

## Build from source

Requires Node 20+.

```bash
git clone https://github.com/shashankbhat2/noat.git
cd noat
npm install
npm run dev              # run in development
npm run build:mac        # build unsigned arm64 and x64 DMG/ZIP artifacts
npm run build:mac:arm64  # build only for Apple Silicon
npm run build:mac:intel  # build only for Intel Macs
```

## Releasing (maintainers)

1. Bump `version` in `package.json` to `X.Y.Z`.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` heading.
3. Commit, then tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. The [release workflow](.github/workflows/release.yml) builds arm64 and x64 DMG/ZIP artifacts on a macOS runner and attaches them to a GitHub Release named after the tag, with the matching `CHANGELOG.md` section as the release notes.

## License

[MIT](LICENSE)
