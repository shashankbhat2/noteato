All notable changes to Noteato are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.1] - 2026-08-06

### Fixed

- Meeting recording now explicitly requests microphone and Screen Recording
  permission instead of silently preflighting and repeatedly sending the user
  back to System Settings.
- A denied or unavailable Screen Recording permission falls back to
  microphone-only capture, preserving the meeting instead of cancelling it.
- Permission recovery guidance appears at most once per app session, and the
  packaged app now includes its Screen Recording usage description.
- CI uses Python 3.11 when rebuilding native dependencies, matching the release
  workflow and avoiding node-gyp failures on newer macOS runners.

## [1.4.0] - 2026-08-06

### Added

- AI-generated note templates. Any note can become a reusable template through
  **Make a template**, using the provider-aware Auto model without adding a
  message to note chat. Templates appear on Home and above the note groups in
  the sidebar.
- Explicit template actions for creating a regular note, starting a recorded
  meeting from the template, or permanently deleting the template. Clicking a
  template itself no longer creates content accidentally.
- A Home chat that starts in place from a central composer, keeps persistent
  conversation history, and leaves New note and New meeting close at hand.
- Provider-aware AI model settings shared by text enhancements and chat. Auto
  chooses an available provider without exposing its underlying model, while
  unavailable providers and models remain disabled until their API key is set.
- AI provider credit or billing status in Settings where the provider exposes
  that information.
- An on-device speech-model setup and download status flow for meeting
  transcription.

### Changed

- The sidebar is fixed at normal window sizes and becomes an overlay drawer in
  compact windows. The app now keeps a usable minimum width, and the sidebar's
  New control offers both New note and New meeting.
- Note chat is a compact single composer that expands into its panel without
  duplicating or moving the input. Agent activity is shown in order from
  preparation through actions and completion, with provider errors surfaced
  directly and no delayed **Apply to note** step.
- Meeting-note enrichment now streams into the note beneath a full-width glass
  progress edge. Transcript editing uses a quiet left-border focus indicator,
  full text blocks, and automatically growing editors.
- Regular notes now use the same folder-backed structure as meetings, beginning
  with `untitled.md`.

### Fixed

- Starting a recording from an existing note now appends its audio and
  transcript instead of losing the new capture.
- A pinned compact sidebar no longer closes when its close control is pressed.
- The responsive sidebar toggle remains clickable above the overlay.
- Meeting and note AI failures now preserve and display the provider's useful
  error detail.

## [1.2.0] - 2026-07-30

A deliberate strip-back. Noteato had accumulated a folder tree, a tag shelf, a
tab strip, zen mode, sticky notes and a quick-note window on top of the notes
themselves. This release removes the chrome and keeps the one power feature
that earns its complexity: side-by-side panes.

### Added

- Pinning a pane. The pin in a note's header holds that note in place: opening
  anything from the sidebar goes to another pane, or opens a new one, rather
  than replacing what you pinned. Keep a reference note on one side and work
  through others beside it. Pinned panes survive a restart, and nothing — not
  the sidebar, not a note link, not the three-pane cap — can evict one.
- Hover to reveal the compact notes panel. Rest the pointer against a screen
  edge and it slides in and takes focus; clicking anything outside puts it
  away again. The edge (left or right) and the delay are both settings, in the
  panel's own settings popover and in Settings → General. The panel now always
  floats above other apps; its pin button controls only whether it follows you
  across Spaces.
- Favourites, which is what pinning a note was always called in the UI. They
  lead the sidebar under their own heading, marked with a star.

### Changed

- **Folders are gone, and the notes directory is flattened on first launch.**
  Every note now lives at the root. The whole original tree is copied into the
  trash as "Folders (before flattening)" before anything moves, so the
  structure can be restored from the Trash view; name clashes are resolved with
  a `-2`, `-3` suffix. Note ids live in frontmatter and are untouched, so open
  panes, note links and reminders all survive. The Notion importer imports flat
  for the same reason.
- **Tabs are gone.** A pane shows one thing. Clicking a note in the sidebar
  replaces the focused pane; ⌘-click, the context menu, or dragging a note to
  the working area's edge opens a new one, up to three. Each pane carries its
  own move/close controls in its header — there is no strip to manage. ⌘W is
  now Close Pane, and closing the last one falls back to Home.
- The sidebar is a flat, recency-sorted list with Favourites at the top and a
  rail of icons along the bottom for Home, Assistant, Import, Settings and
  Trash. The tag section, the folder tree, the section headers and the
  disclosure animations are all gone.
- Search and New note moved out of the sidebar into the title bar, next to the
  sidebar toggle, so they stay reachable when the sidebar is collapsed. The
  shortcut sheet sits at the title bar's far end.
- The assistant's composer is one object: the notes it can see ride in a
  scrollable rail inside the composer rather than wrapping above it, so a long
  context list can't push the conversation off screen. The note it will edit is
  the accent-filled chip; the rest are read-only context.
- Every part of the block editor follows the app's tokens. BlockNote writes its
  theme inline on the editor element, but portals its menus to the document
  body — so dropdowns, submenus, the slash menu and the link popover were all
  falling back to the library's own greys and radii. They now inherit one hover
  wash, one selected wash, one radius scale and one shadow.
- Dictation moved to the note's bottom-left.

### Removed

- Zen mode, sticky notes, and the quick-note window and its global shortcut.
  The compact edge panel (⌘⌥S) is unaffected and keeps its scratch notes.
- Tags in the sidebar. Tags themselves are untouched: the bar under a note's
  title still edits them, they still round-trip through frontmatter, and `#tag`
  search still works.

### Fixed

- Favouriting a note from its own header never reached the sidebar, so the note
  wouldn't move into or out of the group. The main process excludes the sender
  from its change broadcast, making the save callback the only route back — and
  that callback rebuilt the sidebar's copy from a field list that omitted the
  favourite flag.
- The assistant worked on the wrong note. It picked its subject from the
  focused pane, but the focused pane *is* the assistant the moment you click
  into the chat — so it silently fell back to the leftmost note. It now follows
  the note pane you were last in.
- The empty-title placeholder rendered in italic, reading as a styled title
  rather than a prompt.

## [1.1.0] - 2026-07-29

### Added

- Up to three panes side by side, each holding any view — a note, Home, Trash, or the assistant. Drag the seam between two panes to resize just that pair; the combined tab's Arrange Split View menu closes a named pane, separates them, or reverses the order.
- The assistant is a tab now rather than a fixed rail, so it can sit in either half of a split, take a pane of its own, or be closed like anything else. It reads the note in the focused pane as its subject and a second note pane as read-only context.
- Search by tag: `#tag` (or `tag:tag`) filters results, several terms narrow rather than widen, and typing `#` lists the tags in the library. Plain text matches tags too, so `launch` finds notes tagged *launch* without knowing the syntax. Results show their tags, and clicking one filters by it.
- The tab strip's `+` opens a chooser — search your notes, or create one named after whatever you typed — instead of dropping straight into an empty "Untitled".
- Import is a modal listing every source, opened from the sidebar rather than living as a permanent shelf in the note tree.
- Home, Assistant, Settings, Import and Trash are grouped as one list at the top of the sidebar. The keyboard shortcut sheet floats in the working area's bottom-left corner.
- The current frontier models — Claude Fable 5, Opus 5 and Sonnet 5 — in the assistant's picker, which previously offered only the cheap tier, so the hardest questions got the weakest model. Auto still picks a cheap model. Settings' inline-AI picker keeps the cheap tier as its default and groups the rest under "More capable".

### Changed

- Light and dark themes are neutral greyscale rather than warm beige. The note is white (and in dark, a clearly lighter grey than the window behind it), so panes read apart from the chrome at a glance.
- Tabs and panes are one continuous surface: no card gutters, radii or shadows, with the focused tab carrying the pane's colour and running straight into it. Panes are divided by a hairline seam instead of a gap.
- The tab strip is shorter and quieter — its own row height, smaller type, narrower tabs.
- Dictation moved out of the note's toolbar to the bottom-right of the note itself, where it stays put as the note scrolls.
- The selection toolbar follows the app's own menu conventions instead of the editor library's defaults.
- A narrow pane pulls in its gutters and brings headings down to a readable size, so three panes stay writable.
- Modals sit above every other layer and blur the app behind them.

### Fixed

- A note could hang on "Loading…" forever after being moved into split view. Editing a title renames the file on disk, but the tab kept its original path, so remounting the editor read a file that no longer existed — and nothing caught the rejection. Tabs now follow renames, and a read that does fail shows the error with a way to retry.
- A note open in its own pane could also be made the tab strip's note, mounting two live editors for one file and listing it twice in the split tab.
- The tag row sat far below the note's title; the title is the first block and no longer carries a heading's lead-in spacing.
- Tag completions are a themed popover with keyboard navigation, replacing the browser's native datalist.
- Menu highlights are concentric with their menu, and a submenu is no longer clipped by its parent item.
- The split view's arrange caret sits inside the tab rather than on its corner and is centred in its own hover target, and long note titles are shortened in menus.

## [1.0.5] - 2026-07-29

### Added

- Tags on notes, stored in the Markdown frontmatter so they stay readable outside Noteato. The editor's tag bar completes against every tag already in the library, and a Tags section in the sidebar lists them by frequency — picking one replaces the folder tree with a flat list of that tag's notes. Tags on linked files are read-only.
- Copy path and Reveal in Finder in the sidebar and tab context menus.
- Add to split view in the sidebar context menu, which opens a note beside the current one whether or not it is already a tab.

### Fixed

- The title heading is restored automatically when a slash command, markdown shortcut, or backspace demotes it, keeping the caret and the text that was already typed.

## [1.0.4] - 2026-07-29

### Changed

- New app icon, and a matching menu bar icon.

## [1.0.3] - 2026-07-26

### Fixed

- Disabled mandatory code signing, hardened runtime, and notarization while publishing unsigned builds.

## [1.0.2] - 2026-07-26

### Fixed

- Use Python 3.11 when compiling native dependencies because `node-gyp` 9 requires the `distutils` module removed in Python 3.12.

## [1.0.1] - 2026-07-26

### Fixed

- Restored unsigned macOS DMG and ZIP releases while Apple Developer signing credentials are unavailable.
- Pinned Python 3.12 for native dependency builds on GitHub's current macOS runner.

## [1.0.0] - 2026-07-26

### Added

- A Home view with a randomized time-of-day greeting, recently opened and pinned notes as cards, and a month calendar for reminders. Sections can be reordered by dragging their handle.
- A general-purpose assistant docked to the bottom of Home. It expands upward over a blurred backdrop, collapses to just its input, keeps streaming while collapsed, remembers the conversation between visits, and can be switched off entirely.
- A month calendar that shows reminders inside the day cells. Reminders can be added from any day with a half-hour time rail and note search, and removed from the day popover.
- Split view: drag a tab onto either half of the editor, or use the tab context menu. Split tabs collapse into a single grouped tab with an Arrange Split View menu to separate, close either side, or reverse the panes.
- A Trash tab listing every deleted note and folder, with restore and permanent delete, plus Empty Trash.
- A table-of-contents rail down the right edge of each note that expands into full headings on hover and scrolls to a heading on click.
- Pin and unpin a note directly from its header.
- Open external Markdown files and whole folders natively. Linked files and folders are watched, so edits made in other apps appear immediately.
- A model picker for the Home assistant, offering only models whose provider has an API key.

### Changed

- Notes are now stored in a SQLite database for quick notes, sidebar notes, sticky notes, opened-file links, window state, and trash metadata. Existing data is migrated automatically on first launch. Library notes remain plain Markdown files.
- A note's title is now its first block rather than a separate field, so the document begins with a normal heading.
- Rebuilt Settings as a tabbed dialog with grouped sections and one row per setting, and limited AI model choices to fast, inexpensive models.
- Redesigned the sidebar: a full-width search field with its shortcut, a split New note button, and collapsible Pinned Notes, Your Notes, and Import sections.
- Redesigned the app shell around depth: the editor and assistant float as rounded cards above a recessed window base, with warm-tinted borders and shadows and one shared corner radius.
- Made the note header sticky and full width, with the assistant panel header matched to its height.
- External Markdown files are no longer modified when opened; Noteato no longer writes frontmatter into files outside its own library.
- Smoothed open and close animations across the sidebar, assistant panel, note sections, and folders.
- Restored native Intel Mac (x64) builds alongside Apple Silicon (arm64) builds, now signed and notarized.

### Removed

- The plain-Markdown editing mode has been removed from the note editor.
- The Recent section has been removed from the sidebar; recently opened notes now appear on Home.

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

[Unreleased]: https://github.com/shashankbhat2/noteato/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/shashankbhat2/noteato/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/shashankbhat2/noteato/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/shashankbhat2/noteato/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/shashankbhat2/noteato/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/shashankbhat2/noteato/compare/v1.0.5...v1.1.0
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
