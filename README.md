<p align="center">
  <img src="build/icon.png" width="96" alt="Noat icon" />
</p>

<h1 align="center">Noat</h1>

<p align="center">A minimal, block-based note taking app for Mac. Markdown, dictation, sticky notes — nothing else.</p>

<p align="center">
  <a href="https://github.com/shashankbhat2/noat/actions/workflows/ci.yml"><img src="https://github.com/shashankbhat2/noat/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/shashankbhat2/noat/releases/latest"><img src="https://img.shields.io/github/v/release/shashankbhat2/noat" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

## Why

Notion is a great tool that happens to also be a browser tab pretending to be an app: a web renderer, a sync engine, a database, a workspace/permissions model, and a note editor, all bundled together, for people who just want to write something down. Noat is the opposite bet — it does one thing. Blocks and markdown for writing, dictation for when typing is slower than talking, sticky notes for the stuff that doesn't deserve a whole document. Everything lives on your disk as plain `.md` files, not behind an account.

## Features

- **Blocks, not a textarea** — slash menu, headings, to-dos, nesting, etc. ([BlockNote](https://www.blocknotejs.org/))
- **Markdown on disk** — every note is a plain `.md` file with a small frontmatter header. No database, no export step, no lock-in. Sync it with iCloud/Dropbox/git if you want.
- **Dictation** — press the mic button and talk; streamed live to text via [Deepgram Nova-3](https://deepgram.com/). Bring your own API key — no Noat backend sits in between.
- **Sticky notes** — always-on-top, borderless, one click away, visible across every Space.
- **Chrome-style tabs** with a real native titlebar (traffic lights included) instead of a fake toolbar.
- **Light/dark mode**, matched to the actual window chrome, not just the page background.
- **Quick-note shortcuts** — `⌘T` new note, `⌘⇧N` new sticky note, `⌘W` close tab, `⌘,` settings.

No telemetry, no accounts, no auto-updater phoning home. It's an Electron app, so it isn't the smallest possible binary on disk, but there's nothing running that you didn't ask for.

## Install

Grab the latest `.dmg` from [Releases](https://github.com/shashankbhat2/noat/releases/latest), open it, and drag **Noat.app** into **Applications**.

### About the "unidentified developer" warning

This app isn't signed with an Apple Developer ID (that costs $99/year, and this is a free side project) or notarized by Apple. That means on first launch, macOS Gatekeeper will refuse to open it with something like *"Noat can't be opened because it is from an unidentified developer."* This is expected — here's how to get past it, once:

1. In **Applications**, right-click (or Control-click) **Noat.app** and choose **Open**.
2. In the dialog that appears, click **Open** again. macOS remembers this choice and won't ask again for future launches.

If that still doesn't work, strip the quarantine flag manually in Terminal:

```bash
xattr -cr /Applications/Noat.app
```

This is the standard tradeoff for unsigned open-source Mac apps — you're trusting the build, not Apple's notarization service. Check the [Releases](https://github.com/shashankbhat2/noat/releases) page for the commit each build was made from if you want to verify it yourself, or build from source below.

### Dictation setup

Dictation needs a [Deepgram](https://deepgram.com/) API key (their free tier covers casual use; Nova-3 streaming is about $0.0056/min beyond that). Open **Settings** (`⌘,`) inside Noat and paste your key in — it's stored locally in the app's settings file, never sent anywhere but Deepgram.

## Build from source

Requires Node 20+.

```bash
git clone https://github.com/shashankbhat2/noat.git
cd noat
npm install
npm run dev        # run in development
npm run build:mac  # produce a local, unsigned .dmg in dist/
```

## Releasing (maintainers)

1. Bump `version` in `package.json` to `X.Y.Z`.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` heading.
3. Commit, then tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. The [release workflow](.github/workflows/release.yml) builds the DMG/ZIP on a macOS runner and attaches them to a GitHub Release named after the tag, with the matching `CHANGELOG.md` section as the release notes.

## License

[MIT](LICENSE)
