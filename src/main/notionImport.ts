import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join, posix } from 'path'
import type { NotionImportResult } from '../shared/types'
import { NOTE_LINK_PREFIX } from '../shared/noteLink'
import type { NoteStore } from './storage'
import { slugify } from './storage'

// Notion's "Export as Markdown & CSV" suffixes every page/folder/asset name
// with a space + a 32-char lowercase hex id, to disambiguate duplicate
// titles. Strip it before using the name as a title or destination filename.
const HASH_WITH_EXT_RE = /\s[0-9a-f]{32}(\.[A-Za-z0-9]+)$/
const HASH_NO_EXT_RE = /\s[0-9a-f]{32}$/
const MD_EXT_RE = /\.(md|markdown)$/i

function stripHash(name: string, isDir: boolean): string {
  return isDir ? name.replace(HASH_NO_EXT_RE, '') : name.replace(HASH_WITH_EXT_RE, '$1')
}

// Notion puts the page title as the literal first line of the markdown body
// (as an H1) when the page has one. Pull it out so it isn't duplicated —
// once in Noteato's title field, once as the first block of the body.
function extractTitle(raw: string): { title: string | null; body: string } {
  const nlIdx = raw.indexOf('\n')
  const firstLine = (nlIdx === -1 ? raw : raw.slice(0, nlIdx)).trim()
  const match = /^#\s+(.+?)\s*$/.exec(firstLine)
  if (!match) return { title: null, body: raw }
  const rest = (nlIdx === -1 ? '' : raw.slice(nlIdx + 1)).replace(/^\r?\n/, '')
  return { title: match[1].trim(), body: rest }
}

const posixDirOf = (p: string): string => {
  const dir = posix.dirname(p)
  return dir === '.' ? '' : dir
}

type Kind = 'note' | 'file'

interface PlannedItem {
  sourceAbs: string
  finalPath: string
  origRelPath: string
  kind: Kind
  title?: string
  body?: string
  id?: string
}

export function importNotionExport(noteStore: NoteStore, sourceRoot: string): NotionImportResult {
  const notesDir = noteStore.getNotesDir()
  const claimedNotes = new Set<string>()
  const claimedFiles = new Set<string>()
  const pathMap = new Map<string, string>()
  // origRelPath -> note id, for links that target another imported note —
  // those get rewritten to Noteato's own durable "[Title](#note/<id>)" chip
  // syntax instead of a relative path, since ids (unlike paths) survive the
  // target note being renamed or moved after import.
  const noteIds = new Map<string, string>()
  const planned: PlannedItem[] = []

  const claimNote = (title: string): string => {
    let candidate = `${slugify(title)}.md`
    let counter = 2
    while (claimedNotes.has(candidate) || existsSync(join(notesDir, candidate))) {
      candidate = `${slugify(title)}-${counter}.md`
      counter += 1
    }
    claimedNotes.add(candidate)
    return candidate
  }

  const claimFile = (cleanedName: string): string => {
    const dot = cleanedName.lastIndexOf('.')
    const stem = dot > 0 ? cleanedName.slice(0, dot) : cleanedName
    const ext = dot > 0 ? cleanedName.slice(dot) : ''
    let candidate = cleanedName
    let counter = 2
    while (claimedFiles.has(candidate) || existsSync(join(notesDir, candidate))) {
      candidate = `${stem}-${counter}${ext}`
      counter += 1
    }
    claimedFiles.add(candidate)
    return candidate
  }

  // Pass 1: walk the export once, deciding every destination path up front
  // (replicating NoteStore's own slugify + collision-counter rules) so link
  // rewriting in pass 2 can resolve any cross-note reference regardless of
  // which order the two notes happen to be visited in.
  //
  // The export's own directory structure is walked but not reproduced: the
  // library is flat, so a nested Notion page lands beside its parent and the
  // name collisions that used to be spread across folders are all resolved
  // here by the claim helpers. Notion's "<Title> <hash>.md" file next to a
  // same-titled child folder therefore just becomes one more note at the root.
  function walk(srcDir: string, origPrefix: string): void {
    const entries = readdirSync(srcDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue
      const origRel = origPrefix ? `${origPrefix}/${entry.name}` : entry.name
      walk(join(srcDir, entry.name), origRel)
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isFile()) continue
      const srcPath = join(srcDir, entry.name)
      const origRel = origPrefix ? `${origPrefix}/${entry.name}` : entry.name

      if (MD_EXT_RE.test(entry.name)) {
        let raw: string
        try {
          raw = readFileSync(srcPath, 'utf-8')
        } catch {
          continue
        }
        const { title: h1Title, body } = extractTitle(raw)
        const cleanedStem = stripHash(entry.name, false).replace(MD_EXT_RE, '')
        const title = h1Title || cleanedStem || 'Untitled'
        const finalPath = claimNote(title)
        const id = randomUUID()
        pathMap.set(origRel, finalPath)
        noteIds.set(origRel, id)
        planned.push({
          sourceAbs: srcPath,
          finalPath,
          origRelPath: origRel,
          kind: 'note',
          title,
          body,
          id
        })
      } else {
        const finalPath = claimFile(stripHash(entry.name, false))
        pathMap.set(origRel, finalPath)
        planned.push({ sourceAbs: srcPath, finalPath, origRelPath: origRel, kind: 'file' })
      }
    }
  }

  walk(sourceRoot, '')

  // Pass 2: create the notes (rewriting links using the map above), then copy
  // every other file (images, csv exports, etc.) verbatim.
  const created: NotionImportResult['created'] = []
  const skipped: string[] = []

  for (const item of planned) {
    try {
      if (item.kind === 'file') {
        copyFileSync(item.sourceAbs, join(notesDir, item.finalPath))
        continue
      }

      const rewrittenBody = rewriteLinks(item.body ?? '', item.origRelPath, pathMap, noteIds)
      const note = noteStore.create(item.title!, item.id)
      // The real create() call replicates pass 1's slugify+collision prediction
      // exactly (same algorithm, same disk state at call time) — if it ever
      // doesn't, treat the item as failed rather than silently mis-linking.
      if (note.path !== item.finalPath || note.id !== item.id) {
        skipped.push(item.origRelPath)
        continue
      }
      const saved = noteStore.save(note.path, { title: item.title!, body: rewrittenBody })
      created.push(saved)
    } catch {
      skipped.push(item.origRelPath)
    }
  }

  return { created, skipped }
}

const LINK_RE = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g

function rewriteLinks(
  body: string,
  ownOrigRelPath: string,
  pathMap: Map<string, string>,
  noteIds: Map<string, string>
): string {
  const ownOrigDir = posixDirOf(ownOrigRelPath)

  return body.replace(LINK_RE, (whole, open: string, target: string, close: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole // http(s), notion.so, mailto, etc.
    let decoded: string
    try {
      decoded = decodeURIComponent(target.split('#')[0])
    } catch {
      return whole
    }
    const originalAbs = posix.normalize(posix.join(ownOrigDir, decoded))

    // A link to another imported note becomes a durable Noteato note-link
    // (id-based) instead of a relative path — but never for an image embed,
    // which can't sensibly point at a note.
    const noteId = noteIds.get(originalAbs)
    if (noteId && !open.startsWith('!')) {
      return `${open}${NOTE_LINK_PREFIX}${noteId}${close}`
    }

    // Everything lands in one directory, so a surviving link (an image, a CSV)
    // is always a sibling reference by name.
    const mappedFinal = pathMap.get(originalAbs)
    if (!mappedFinal) return whole
    return `${open}${encodeURIComponent(mappedFinal)}${close}`
  })
}
