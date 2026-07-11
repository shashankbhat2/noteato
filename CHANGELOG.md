All notable changes to Noteato are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-07-11

### Added

- A right-side agent panel with note context, per-note chat history, model selection, new chats, streamed responses, and full-note editing.
- Nested folders with create, rename, move, drag-and-drop, and folder-aware note creation.
- Full-text note search, pinned notes, contextual note actions, and undoable note and folder deletion.
- Accent color presets and a plain Markdown editing mode.

### Changed

- Reworked the app header, tab strip, sidebar, editor spacing, settings controls, and shortcuts placement for a denser desktop layout.
- Moved the agent toggle into the app header and made the sidebar darker than the editor in every theme.
- Moved dictation into a compact editor option with a smaller live-state waveform.
- Renamed AI selection tools to Enhance and streamed improvements directly into the selected blocks with progress and changed-block highlighting.
- Expanded inexpensive OpenAI and Anthropic model choices for Enhance and the agent.

### Fixed

- Applied the selected accent consistently across AI, dictation, and interactive states.
- Preserved bare URL links through rich-editor Markdown round trips.
- Created new notes inside the selected folder from the sidebar, header, empty state, and keyboard shortcut.
- Added consistent vertical spacing to AI preferences and feature toggles in Settings.

## [0.4.0] - 2026-07-11

### Added

- Optional bring-your-own-key AI features for Anthropic and OpenAI.
- Selection actions for summarizing, improving, and extracting key points from highlighted note content.
- Ask-note popup for questions about the current note.
- Optional AI cleanup for live dictation.

### Changed

- Renamed the app from Noat to Noteato.
- Builds now target Apple Silicon (arm64) only — Intel (x64) builds have been dropped.
- Updated the macOS app icon from the Noteato app icon set.

## [0.3.0] - 2026-07-10

### Added

- Window size and position now persist across restarts — Noteato reopens at the size and place you left it, including maximized state.
- Double-click anywhere on the empty header to maximize/restore the window.
- Minimum window width lowered to 350px, so the window is resizable down to a much narrower layout.

## [0.2.0] - 2026-07-10

### Added

- Collapsible sidebar (`⌘\`) and a Zen mode (`⌘.`) that hides the sidebar and tabs entirely for distraction-free writing — both persist across restarts.
- Per-note full-width toggle, independent per note.
- Font setting: System, Serif, Mono, or Rounded.
- Notes folder picker in Settings — moves existing notes to the new location instead of orphaning them.
- Import existing markdown files (`⌘O`) as new notes.
- Keyboard shortcuts help popup, reachable from anywhere including Zen mode.
- Dictation now lives in a floating panel with a live horizontal waveform instead of an inline header button.
- Subtle motion throughout the UI (tab/panel transitions, hover states), respecting `prefers-reduced-motion`.

### Changed

- Settings moved back from a tab to a modal.
- Renamed the app from Nota to Noat.
- Enter in the title field now jumps focus into the note body, matching Notion.
- The app now opens the most recently edited note on launch instead of showing an empty state when notes already exist.
- Tables, quotes, and dividers now follow the app's own light/dark palette instead of BlockNote's hardcoded colors.

### Fixed

- Renaming a note's title now correctly renames its underlying file on disk (a prior crash-fix had left filenames stuck at their original value).
- Wide tables no longer get clipped — they scroll horizontally within their own row, with a visible scrollbar.

## [0.1.0] - 2026-07-10

### Added

- Block-based markdown editor (BlockNote): slash menu, nesting, to-dos, headings, etc.
- Notes stored as plain `.md` files on disk (no database, no lock-in).
- Dictation via Deepgram Nova-3 streaming (bring your own API key).
- Sticky notes: always-on-top, borderless, persist across restarts.
- Chrome-style tabs with a native hidden titlebar and real traffic-light controls.
- Light/dark theme, matched to the native window chrome.
- Quick-note shortcuts: `⌘T` new note, `⌘⇧N` new sticky note, `⌘W` close tab, `⌘,` settings.

[Unreleased]: https://github.com/shashankbhat2/noteato/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/shashankbhat2/noteato/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/shashankbhat2/noteato/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/shashankbhat2/noteato/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/shashankbhat2/noteato/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shashankbhat2/noteato/releases/tag/v0.1.0
