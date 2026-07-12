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
  const claimedFolders = new Set<string>()
  const folderOrder: string[] = []
  const pathMap = new Map<string, string>()
  // origRelPath -> note id, for links that target another imported note —
  // those get rewritten to Noteato's own durable "[Title](#note/<id>)" chip
  // syntax instead of a relative path, since ids (unlike paths) survive the
  // target note being renamed or moved after import.
  const noteIds = new Map<string, string>()
  const planned: PlannedItem[] = []

  const claimNote = (folder: string, title: string): string => {
    let base = `${slugify(title)}.md`
    let counter = 1
    const relOf = (name: string): string => (folder ? `${folder}/${name}` : name)
    let candidate = relOf(base)
    while (claimedNotes.has(candidate) || existsSync(join(notesDir, candidate))) {
      base = `${slugify(title)}-${counter}.md`
      candidate = relOf(base)
      counter += 1
    }
    claimedNotes.add(candidate)
    return candidate
  }

  const claimFile = (folder: string, cleanedName: string): string => {
    const dot = cleanedName.lastIndexOf('.')
    const stem = dot > 0 ? cleanedName.slice(0, dot) : cleanedName
    const ext = dot > 0 ? cleanedName.slice(dot) : ''
    let name = cleanedName
    let counter = 1
    const relOf = (): string => (folder ? `${folder}/${name}` : name)
    let candidate = relOf()
    while (claimedFiles.has(candidate) || existsSync(join(notesDir, candidate))) {
      name = `${stem}-${counter}${ext}`
      candidate = relOf()
      counter += 1
    }
    claimedFiles.add(candidate)
    return candidate
  }

  const claimFolder = (parent: string, cleanedName: string): string => {
    let name = cleanedName || 'Untitled'
    let counter = 1
    const relOf = (): string => (parent ? `${parent}/${name}` : name)
    let candidate = relOf()
    while (claimedFolders.has(candidate) || existsSync(join(notesDir, candidate))) {
      name = `${cleanedName || 'Untitled'}-${counter}`
      candidate = relOf()
      counter += 1
    }
    claimedFolders.add(candidate)
    folderOrder.push(candidate)
    return candidate
  }

  // Pass 1: walk the export once, deciding every destination path up front
  // (replicating NoteStore's own slugify + collision-counter rules) so link
  // rewriting in pass 2 can resolve any cross-note reference regardless of
  // which order the two notes happen to be visited in.
  //
  // A Notion page with children exports as a "<Title> <hash>.md" file
  // alongside a same-titled sibling folder (folders don't get the hash
  // suffix) holding the children. Directories are processed — and recursed
  // into — before files at the same level, so a file whose cleaned stem
  // matches a sibling folder's name can be nested *inside* that folder
  // (as that page's own note, alongside its children) instead of sitting
  // beside it as a confusing duplicate-named top-level entry.
  function walk(srcDir: string, destFolder: string, origPrefix: string): void {
    const entries = readdirSync(srcDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    const folderFinalPathByCleanedName = new Map<string, string>()

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue
      const srcPath = join(srcDir, entry.name)
      const origRel = origPrefix ? `${origPrefix}/${entry.name}` : entry.name
      const cleaned = stripHash(entry.name, true)
      const finalPath = claimFolder(destFolder, cleaned)
      pathMap.set(origRel, finalPath)
      folderFinalPathByCleanedName.set(cleaned, finalPath)
      walk(srcPath, finalPath, origRel)
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
        const targetFolder = folderFinalPathByCleanedName.get(cleanedStem) ?? destFolder
        const finalPath = claimNote(targetFolder, title)
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
        const cleaned = stripHash(entry.name, false)
        const finalPath = claimFile(destFolder, cleaned)
        pathMap.set(origRel, finalPath)
        planned.push({ sourceAbs: srcPath, finalPath, origRelPath: origRel, kind: 'file' })
      }
    }
  }

  walk(sourceRoot, '', '')

  // Pass 2: materialize folders, then notes (rewriting links using the map
  // above), then copy every other file (images, csv exports, etc.) verbatim.
  for (const folder of folderOrder) {
    noteStore.createFolder(folder)
  }

  const created: NotionImportResult['created'] = []
  const skipped: string[] = []

  for (const item of planned) {
    try {
      if (item.kind === 'file') {
        // Every destination folder was already created above, in walk order.
        copyFileSync(item.sourceAbs, join(notesDir, item.finalPath))
        continue
      }

      const rewrittenBody = rewriteLinks(item.body ?? '', item.origRelPath, pathMap, noteIds)
      const note = noteStore.create(item.title!, posixDirOf(item.finalPath), item.id)
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
  const ownFinalPath = pathMap.get(ownOrigRelPath)
  const ownFinalDir = ownFinalPath ? posixDirOf(ownFinalPath) : ''

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

    const mappedFinal = pathMap.get(originalAbs)
    if (!mappedFinal) return whole
    const rel = posix.relative(ownFinalDir, mappedFinal) || posix.basename(mappedFinal)
    const encoded = rel
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
    return `${open}${encoded}${close}`
  })
}
