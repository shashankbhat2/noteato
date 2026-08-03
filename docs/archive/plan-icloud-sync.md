# Noteato iCloud Sync Implementation Plan

## Recommended approach

Use Apple’s iCloud Documents/Drive container as the storage location for managed Markdown notes. Keep the Markdown tree as the source of truth rather than introducing CloudKit or a second authoritative database.

```text
Main app / Sidebar / Quick note
              ↓ IPC
          NoteService
       ↙               ↘
Local backend       iCloud backend
Node filesystem     Native Apple bridge
                    NSFileCoordinator
                    NSFilePresenter
```

The existing Markdown frontmatter already stores IDs, tags, pins, timestamps, and reminders, making it a suitable portable sync format. Linked external files, settings, API keys, and window state remain device-local.

## Prerequisites

The current build is unsigned and unhardened. Before shipping iCloud sync:

1. Join the paid Apple Developer Program.
2. Register the explicit App ID `com.noteato.app`.
3. Create a permanent iCloud container, preferably `iCloud.com.noteato.app`.
4. Enable iCloud Documents for the App ID.
5. Create a Developer ID provisioning profile.
6. Sign, harden, and notarize release builds.

Apple references:

- [Supported macOS capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-macos)
- [Provisioning profile details](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
- [Enabling iCloud capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/)

## Phase 1: Separate storage from note logic

Refactor `src/main/storage.ts` into:

- `NoteService`: parsing, IDs, naming, search, reminders, and validation.
- `LocalStorageBackend`: the current filesystem behavior.
- `ICloudStorageBackend`: coordinated iCloud operations.
- A `StorageBackend` interface for read, write, move, delete, list, and observe.

Keep relative paths as location identifiers and use each note UUID as its durable identity when files are renamed or moved.

Add settings:

```ts
storageMode: 'local' | 'icloud'
localNotesDir: string | null
icloudMigrationVersion: number
```

Never persist the resolved iCloud filesystem path because it can change between machines and accounts.

## Phase 2: Native macOS iCloud bridge

Build a small arm64 N-API Objective-C++ module loaded into Electron’s main process. It should expose:

- iCloud identity and availability.
- `FileManager.url(forUbiquityContainerIdentifier:)`.
- Coordinated read, write, replace, move, and delete.
- Directory presentation and change notifications.
- Download status and explicit download requests.
- `NSFileVersion` conflict enumeration and resolution.

Do not hardcode `~/Library/Mobile Documents/...`. Apple requires coordinated access for iCloud documents:

- [Designing for Documents in iCloud](https://developer.apple.com/library/archive/documentation/General/Conceptual/iCloudDesignGuide/Chapters/DesigningForDocumentsIniCloud.html)
- [NSFileCoordinator](https://developer.apple.com/documentation/foundation/nsfilecoordinator)

Suggested container layout:

```text
iCloud container/
├── Documents/
│   └── Notes/**/*.md
└── Data/
    ├── Trash/
    └── Migration/
```

## Phase 3: Conflict-aware writes

Extend `Note` and `SaveOptions` with a content revision hash. On save:

1. Send the revision originally loaded by the editor.
2. Coordinately read the current iCloud version.
3. Save normally when revisions match.
4. If they differ, never silently overwrite.
5. Attempt a three-way Markdown merge.
6. If the merge is ambiguous, preserve both versions and create a conflict note with a new UUID.

Incoming changes should reload clean editors, preserve dirty buffers, update paths after remote moves, broadcast through `notes:changed`, and rebuild affected reminder timers.

Use `NSFileVersion` to enumerate unresolved iCloud versions and preserve each version before marking a conflict resolved. See [Apple’s conflict guidance](https://developer.apple.com/library/archive/technotes/tn2336/).

## Phase 4: Safe migration

Enabling iCloud should be opt-in and transactional:

1. Flush every open editor.
2. Verify the iCloud identity and container.
3. Create a timestamped local backup.
4. Inventory local and existing iCloud notes by UUID and content hash.
5. Copy through coordinated iCloud operations.
6. Resolve collisions without overwriting:
   - Same UUID and hash: deduplicate.
   - Same UUID with different content: start the conflict workflow.
   - Same filename with different UUIDs: suffix the filename.
7. Verify file counts and hashes.
8. Switch `storageMode` only after verification succeeds.
9. Retain the backup until the user explicitly removes it.

Disabling sync first copies the current tree to a selected local directory. It must not delete the iCloud copy automatically.

## Phase 5: Sync experience

Add a Storage section to Settings with:

- “Sync managed notes with iCloud.”
- Status: unavailable, preparing, syncing, up to date, offline, or conflict.
- “Open Noteato in iCloud Drive.”
- “Resolve conflicts.”
- “Move notes back to This Mac.”
- Last error with a retry action.

While iCloud mode is active, replace the local folder picker with iCloud storage controls. External linked Markdown files remain labeled “This Mac only.”

## Phase 6: Signing and release pipeline

Add:

- Development and production entitlements.
- The `CloudDocuments` service.
- iCloud and ubiquity container identifiers.
- `NSUbiquitousContainers` metadata for Finder visibility.
- Hardened runtime.
- Developer ID signing and an embedded provisioning profile.
- Notarization credentials in GitHub Actions.
- Post-build validation using `codesign`, provisioning-profile inspection, and `spctl`.

Keep App Sandbox disabled initially so arbitrary linked files continue to work. A future Mac App Store build would require sandboxing and security-scoped bookmarks.

## First-release sync scope

Synced:

- Managed Markdown notes and folders.
- Titles and body content.
- Tags and pin state.
- Reminders.
- Reversible trash records.

Device-local:

- AI and dictation API keys.
- Theme and appearance.
- Sidebar and window state.
- Global shortcut settings.
- Linked external files.
- Sticky-note window geometry.

Reminder delivery remains device-local. When several Macs are online, a reminder can briefly fire on more than one device before its cleared state propagates.

## Validation and rollout

Test with two Macs on the same iCloud account:

- Online and offline concurrent edits.
- Rename, move, delete, restore, and folder operations.
- Remote changes while an editor has unsaved changes.
- iCloud sign-out and sign-in.
- iCloud Drive disabled or storage full.
- App closed to the Dock but running in the menu bar.
- Crash recovery during migration.
- Unicode and deeply nested paths.
- At least 5,000 notes.
- Upgrade from the current unsigned build.

Ship behind an opt-in beta flag first, with migration backups and structured local sync logs. Estimated implementation time is three to four engineering weeks after Apple signing assets are available.
