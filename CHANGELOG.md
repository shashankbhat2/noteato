All notable changes to Noteato are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.9.0] - 2026-07-15

### Added

- A clean edge-docked sidebar for notes and reminders, with search, grouping, pin and close controls, and the compact block-based editor.
- A centered quick-note overlay, available globally with `⌥⌘N` on macOS and `Ctrl+Alt+N` elsewhere.
- A global sidebar shortcut (`⌥⌘S` on macOS and `Ctrl+Alt+S` elsewhere), menu-bar access, and compact settings in the sidebar header.

### Changed

- Enabled the menu bar, sidebar mode, and quick-note shortcut by default for new settings.
- Kept notes and reminders synchronized across the main app, sidebar, and quick-note windows.
- Updated the sidebar to use a solid surface and the Noteato app icon.

## [0.8.0] - 2026-07-13

### Added

- Find and replace within the current note, accessible with `⌘F`.
- Syntax-highlighted code blocks, inline-code input, and automatic arrow substitutions in the editor.
- A Recent section in the sidebar and restoration of open and pinned tabs between sessions.
- Rich Markdown rendering for AI responses.
- Native spelling suggestions and configurable spellcheck dictionaries on Windows and Linux.
- A New page action in the editor slash menu.

### Changed

- Expanded editor context menus with spelling, lookup, web search, and standard editing actions.
- Improved block and heading-section dragging, block merging, and keyboard movement between the title and body.
- Improved sidebar drag-and-drop behavior and nested context-menu navigation.
- Kept AI popups and context menus within the visible window.

### Fixed

- Preserved Noteato note links after paste, drag-and-drop, AI edits, and other editor updates.
- Restricted links opened from AI responses to safe web and email protocols.
- Made restored-tab data resilient to incomplete or older saved state.

## [0.7.3] - 2026-07-12

### Changed

- Added a visual export guide to the Notion import flow.
- Removed the redundant Linked label above external folders in the sidebar.

## [0.7.2] - 2026-07-12

### Changed

- With "Keep in menu bar" on, closing the window now also removes Noteato from the Dock (no icon or running dot) while it keeps running in the menu bar — like other menu-bar apps. Reopening it from the menu bar, a reminder, or Spotlight restores the Dock icon, and quitting from the menu bar removes the tray icon immediately.

## [0.7.1] - 2026-07-12

### Fixed

- The menu bar (tray) icon rendered blank due to a corrupted embedded image; it now shows correctly and adapts to light and dark menu bars.
- App icon is now built from the properly rendered per-size icon set, so it stays crisp at small sizes (Finder lists, Spotlight, Dock at small sizes).

## [0.7.0] - 2026-07-12

### Added

- Reminders: set a one-time date/time reminder on any note from the editor toolbar or the sidebar's right-click menu, with quick presets and a custom picker. Fires a native notification even if the note isn't open; clicking it opens the note. Reminders that pass while the app is closed surface as a catch-up notification on the next launch.
- Notion import: "Import Notion Export…" (Note menu) turns a folder from Notion's own "Export → Markdown & CSV" into notes and folders, preserving the page hierarchy, stripping Notion's id suffixes from titles/filenames, and rewriting internal page and image links to point at their new location. Database exports are copied in as plain `.csv` files rather than parsed.
- Menu bar option (Settings → Menu bar, off by default): keeps Noteato running in the menu bar instead of quitting on ⌘Q or the traffic-light close, so reminders can still fire. Quit fully from the menu bar icon's own "Quit Noteato."
- The sidebar's import button is now a dropdown: "From Markdown…" and "From Notion…". Choosing Notion first shows a how-to guide before the folder picker.

### Changed

- New app icon, and a matching menu-bar icon that now renders as a template image so it adapts to light and dark menu bars.
- Notion import: links between imported pages now become real, durable note links (Noteato's own mention chips, resolved by id) instead of plain relative-path links, so they keep working even if a note is later renamed or moved. A page that has sub-pages now imports as a note living inside its own children's folder, rather than as an oddly-duplicated same-named sibling.

### Fixed

- Backspace at the very start of a note's first (paragraph) block now moves the cursor into the title, and the down arrow in the title now moves into the body — matching the existing up-arrow/Enter behavior in the other direction.

## [0.6.0] - 2026-07-11

### Added

- Note links: type "@" in the editor to insert a Notion-style mention chip that opens the linked note in a tab and keeps working after moves and renames.
- Agent upgrades: @-mention other notes as read-only chat context, create new notes from chat (with clickable chips for the results), bigger model choices, and a stop button with real request cancellation.
- Proofread and Summarize enhance actions that stream into an in-place overlay bubble with Copy, Insert below, and Replace; Extract key points now appends below the selection instead of overwriting it.
- Notion-style vertical block menu on the drag handle: turn into, copy, duplicate, and delete.
- Tab bar: right-click menu (pin, close others, close to the right, close all), pinned tabs that survive bulk closes, and previous/next tab navigation buttons.
- Double-click inline renaming for notes and folders in the sidebar, plus a Rename context-menu action.
- The OS now recognizes the app as a Markdown editor — files opened from Finder are imported and opened automatically.

### Changed

- The agent applies note edits before announcing them, showing an "Updating notes…" state while it works.
- Sidebar note tiles show only the title, and folder rows are taller.
- Dictation auto-scrolls to keep the text being written in view.
- Arrow-up from the first line of a note moves the caret into the title.
- More breathing room between block text and its side actions; nested list indent guides removed.

### Fixed

- Selecting a divider no longer shows the formatting toolbar or a blue node highlight.
- Enhance is only offered for text selections, not tables, media, or dividers.

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

[Unreleased]: https://github.com/shashankbhat2/noteato/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/shashankbhat2/noteato/compare/v0.7.3...v0.8.0
[0.7.3]: https://github.com/shashankbhat2/noteato/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/shashankbhat2/noteato/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/shashankbhat2/noteato/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/shashankbhat2/noteato/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/shashankbhat2/noteato/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/shashankbhat2/noteato/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/shashankbhat2/noteato/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/shashankbhat2/noteato/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/shashankbhat2/noteato/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shashankbhat2/noteato/releases/tag/v0.1.0
