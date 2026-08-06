import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NoteStore } from '../src/main/storage'

/**
 * Phase 1.5: identity is the note's id, not its path.
 *
 * These are the cases that made the refactor worth doing — every one of them
 * silently pointed at the wrong file, or at nothing, while paths were identity.
 */
describe('note identity', () => {
  let dir: string
  let db: Database.Database
  let store: NoteStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noteato-id-'))
    db = new Database(':memory:')
    store = new NoteStore(db, dir)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves a note by id', () => {
    const created = store.create('Launch notes')
    expect(store.resolvePath(created.id)).toBe(created.path)
    expect(store.read(created.id).title).toBe('Launch notes')
  })

  it('creates an untitled note in its own timestamped folder', () => {
    const created = store.create()

    expect(created.path).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[a-z0-9]{4,}\/untitled\.md$/
    )
    expect(created.folder).toBe(dirname(created.path))
    expect(existsSync(join(dir, created.path))).toBe(true)
    expect(store.bundledDirectory(created.id)).toBe(join(dir, created.folder))
  })

  // The bug this refactor is about: a title change renames the file, so
  // anything holding the old path was pointing at nothing.
  it('follows a note across a rename', () => {
    const created = store.create('Before')
    const saved = store.save(created.id, { title: 'After', body: '# After\n\nbody' })

    expect(saved.path).not.toBe(created.path)
    expect(saved.id).toBe(created.id)
    // Same id, new location, no rescan needed by the caller.
    expect(store.read(created.id).title).toBe('After')
    expect(store.resolvePath(created.id)).toBe(saved.path)
  })

  it('survives two renames in a row', () => {
    const created = store.create('One')
    store.save(created.id, { title: 'Two', body: '# Two' })
    store.save(created.id, { title: 'Three', body: '# Three' })
    expect(store.read(created.id).title).toBe('Three')
  })

  it('finds a note that was renamed on disk outside the app', () => {
    const created = store.create('Outside')
    store.read(created.id) // warm the index with the old location
    const folder = dirname(created.path)
    renameSync(join(dir, created.path), join(dir, folder, 'moved-by-hand.md'))

    // The cached path no longer exists, so the index has to rebuild rather
    // than report the note as gone.
    expect(store.resolvePath(created.id)).toBe(`${folder}/moved-by-hand.md`)
    expect(store.read(created.id).title).toBe('Outside')
  })

  it('does not resolve an id to a file that reused its old name', () => {
    const first = store.create('Shared name')
    const path = first.path
    store.read(first.id)

    // Delete it and drop a different note at exactly the same filename.
    rmSync(join(dir, path))
    writeFileSync(
      join(dir, path),
      `---\nid: some-other-id\ntitle: "Shared name"\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\ntags: []\nfullWidth: false\npinned: false\nreminderAt: \n---\n\n# Shared name\n`,
      'utf-8'
    )

    // A stale cache entry would hand back the impostor's path.
    expect(() => store.resolvePath(first.id)).toThrow(/No note with id/)
  })

  it('throws for an unknown id rather than guessing', () => {
    expect(() => store.read('not-a-real-id')).toThrow(/No note with id/)
  })

  it('stops resolving an id after the note is deleted', () => {
    const created = store.create('Doomed')
    store.delete(created.id)
    expect(() => store.resolvePath(created.id)).toThrow(/No note with id/)
  })

  it('deletes and restores an ordinary note together with its folder', () => {
    const created = store.create()
    const folder = created.folder

    const deleted = store.delete(created.id)
    expect(deleted.isFolder).toBe(true)
    expect(deleted.originalPath).toBe(folder)
    expect(existsSync(join(dir, folder))).toBe(false)

    const restored = store.restore(deleted.trashName, deleted.originalPath, deleted.isFolder)
    expect(restored?.id).toBe(created.id)
    expect(restored?.path).toBe(created.path)
    expect(existsSync(join(dir, created.path))).toBe(true)
  })

  it('keeps pin and reminder on the note they were set on, across a rename', () => {
    const created = store.create('Pinned')
    store.setPinned(created.id, true)
    store.setReminder(created.id, '2026-09-01T09:00:00.000Z')
    store.save(created.id, { title: 'Renamed while pinned', body: '# Renamed while pinned' })

    const after = store.read(created.id)
    expect(after.pinned).toBe(true)
    expect(after.reminderAt).toBe('2026-09-01T09:00:00.000Z')
  })

  it('tells two notes apart when one is renamed onto the other’s old name', () => {
    const a = store.create('Alpha')
    const b = store.create('Beta')
    // Free up "alpha.md", then rename Beta into it.
    store.save(a.id, { title: 'Gamma', body: '# Gamma' })
    store.save(b.id, { title: 'Alpha', body: '# Alpha' })

    expect(store.read(a.id).title).toBe('Gamma')
    expect(store.read(b.id).title).toBe('Alpha')
    expect(store.resolvePath(a.id)).not.toBe(store.resolvePath(b.id))
  })
})

/**
 * A capture is a note that lives in a directory beside its audio (revamp brief
 * §4.3). The library has to treat it as an ordinary note without disturbing
 * that arrangement — the audio is the one file here that cannot be regenerated.
 */
describe('captured notes', () => {
  let dir: string
  let db: Database.Database
  let store: NoteStore

  const captureDirName = '2026-08-01T14-32-11Z-a7f3'

  const writeCapture = (root: string, name = captureDirName, id = 'capture-id-1'): void => {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'audio.m4a'), 'not really audio, but a file')
    writeFileSync(
      join(root, name, 'note.md'),
      `---\nid: ${id}\ntitle: "Capture 1 Aug, 14:32"\ncreatedAt: 2026-08-01T14:32:11.000Z\nupdatedAt: 2026-08-01T14:32:11.000Z\ntags: []\nfullWidth: false\npinned: false\nreminderAt: \nsource: capture\ndurationSeconds: 12\n---\n\n# Capture 1 Aug, 14:32\n`,
      'utf-8'
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noteato-capture-'))
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('surfaces a captured note in the library', () => {
    writeCapture(dir)
    store = new NoteStore(db, dir)
    const summaries = store.list()
    expect(summaries.map((s) => s.id)).toContain('capture-id-1')
    expect(store.read('capture-id-1').title).toBe('Capture 1 Aug, 14:32')
  })

  it('creates a new meeting note inside its capture folder with an empty body', () => {
    store = new NoteStore(db, dir)
    const created = store.createCaptureNote(captureDirName, 'Meeting — Aug 1, 2:32 PM')

    expect(created.path).toBe(`${captureDirName}/note.md`)
    expect(created.folder).toBe(captureDirName)
    expect(store.read(created.id).body.trim()).toBe('')
    expect(existsSync(join(dir, captureDirName, 'note.md'))).toBe(true)
  })

  // The bug this guards: flattening moves nested notes to the root. Doing that
  // to a capture would leave the markdown at the top level and its recording
  // stranded in a directory nothing points at.
  it('leaves a capture in its directory when the library is flattened', () => {
    writeCapture(dir)
    // A genuinely nested note, which flattening *should* move.
    mkdirSync(join(dir, 'Old Folder'), { recursive: true })
    writeFileSync(
      join(dir, 'Old Folder', 'legacy.md'),
      `---\nid: legacy-1\ntitle: "Legacy"\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\ntags: []\nfullWidth: false\npinned: false\nreminderAt: \n---\n\n# Legacy\n`,
      'utf-8'
    )

    store = new NoteStore(db, dir) // constructor runs flattenLibrary()

    // The capture is untouched, audio still beside it.
    expect(existsSync(join(dir, captureDirName, 'note.md'))).toBe(true)
    expect(existsSync(join(dir, captureDirName, 'audio.m4a'))).toBe(true)
    expect(store.resolvePath('capture-id-1')).toBe(`${captureDirName}/note.md`)

    // The ordinary nested note was flattened, as before.
    expect(existsSync(join(dir, 'legacy.md'))).toBe(true)
  })

  it('keeps a capture in place when its title changes', () => {
    writeCapture(dir)
    store = new NoteStore(db, dir)
    const saved = store.save('capture-id-1', {
      title: 'Thoughts on the launch',
      body: '# Thoughts on the launch\n\ntranscribed later'
    })

    // A rename must not move the note away from its audio.
    expect(saved.path).toBe(`${captureDirName}/note.md`)
    expect(existsSync(join(dir, captureDirName, 'audio.m4a'))).toBe(true)
    expect(store.read('capture-id-1').title).toBe('Thoughts on the launch')
  })

  it('moves and restores a meeting note together with its audio', () => {
    writeCapture(dir)
    store = new NoteStore(db, dir)

    const deleted = store.delete('capture-id-1')
    expect(deleted.isFolder).toBe(true)
    expect(deleted.originalPath).toBe(captureDirName)
    expect(existsSync(join(dir, captureDirName))).toBe(false)

    expect(store.restore(deleted.trashName, deleted.originalPath, deleted.isFolder)?.id).toBe(
      'capture-id-1'
    )
    expect(existsSync(join(dir, captureDirName, 'note.md'))).toBe(true)
    expect(existsSync(join(dir, captureDirName, 'audio.m4a'))).toBe(true)
    expect(store.read('capture-id-1').title).toBe('Capture 1 Aug, 14:32')
  })

  it('deletes the recording folder by its stored association even with a nonstandard name', () => {
    store = new NoteStore(db, dir)
    const folder = 'Customer follow-up'
    writeCapture(dir, folder, 'associated-capture')
    ;(db as unknown as { recordings: Map<string, { capture_dir: string }> }).recordings.set(
      'associated-capture',
      { capture_dir: join(dir, folder) }
    )
    store.list()

    const deleted = store.delete('associated-capture')

    expect(deleted.isFolder).toBe(true)
    expect(deleted.originalPath).toBe(folder)
    expect(existsSync(join(dir, folder))).toBe(false)
  })

  it('moves an ordinary note into its first recording folder and deletes them together', () => {
    store = new NoteStore(db, dir)
    const note = store.create('Customer call')
    const capture = join(dir, captureDirName)
    mkdirSync(capture, { recursive: true })
    writeFileSync(join(capture, 'audio.m4a'), 'audio')

    const moved = store.moveIntoCapture(note.id, capture)
    ;(db as unknown as { recordings: Map<string, { capture_dir: string }> }).recordings.set(
      note.id,
      { capture_dir: capture }
    )

    expect(moved.path).toBe(`${captureDirName}/note.md`)
    expect(existsSync(join(dir, note.path))).toBe(false)
    expect(existsSync(join(capture, 'note.md'))).toBe(true)

    const deleted = store.delete(note.id)
    expect(deleted.isFolder).toBe(true)
    expect(existsSync(capture)).toBe(false)
  })

  it('bundles and trashes older split note and recording artifacts', () => {
    store = new NoteStore(db, dir)
    const note = store.create('Legacy recorded note')
    const capture = join(dir, captureDirName)
    mkdirSync(capture, { recursive: true })
    writeFileSync(join(capture, 'audio.m4a'), 'audio')
    ;(db as unknown as { recordings: Map<string, { capture_dir: string }> }).recordings.set(
      note.id,
      { capture_dir: capture }
    )

    const deleted = store.delete(note.id)

    expect(deleted.isFolder).toBe(true)
    expect(existsSync(capture)).toBe(false)
    const restored = store.restore(deleted.trashName, deleted.originalPath, deleted.isFolder)
    expect(restored?.id).toBe(note.id)
    expect(existsSync(join(capture, 'audio.m4a'))).toBe(true)
    expect(existsSync(join(capture, 'note.md'))).toBe(true)
  })
})
