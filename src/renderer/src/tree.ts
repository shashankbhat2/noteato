import type { NoteSummary } from '../../shared/types'

export interface FolderNode {
  /** Folder display name ("" for the root). */
  name: string
  /** Relative POSIX path of this folder ("" for the root). */
  path: string
  folders: FolderNode[]
  notes: NoteSummary[]
}

// Build a folder tree from the flat note list + the full folder-path list.
// The folder list ensures empty folders still appear.
export function buildTree(notes: NoteSummary[], folders: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], notes: [] }
  const map = new Map<string, FolderNode>([['', root]])

  const ensure = (path: string): FolderNode => {
    const existing = map.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const name = path.slice(slash + 1)
    const parent = ensure(slash === -1 ? '' : path.slice(0, slash))
    const node: FolderNode = { name, path, folders: [], notes: [] }
    parent.folders.push(node)
    map.set(path, node)
    return node
  }

  for (const f of folders) ensure(f)
  for (const n of notes) ensure(n.folder).notes.push(n)

  const sortNode = (node: FolderNode): void => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name))
    node.notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    node.folders.forEach(sortNode)
  }
  sortNode(root)
  return root
}
