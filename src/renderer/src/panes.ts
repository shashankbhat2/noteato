/**
 * The working area is a row of one to three panes. There are no tabs: a pane
 * shows exactly one thing, and the sidebar/title bar act on the focused pane.
 */

export type PaneView =
  /**
   * A note pane holds an id, never a path. Renaming a note renames its file,
   * so a pane keyed on location would lose the note the moment its title
   * changed. `title` rides along only so the pane can label itself without a
   * read.
   */
  | { kind: 'note'; id: string; title: string }
  | { kind: 'empty' }
  | { kind: 'trash' }

export interface Pane {
  /**
   * Identity for React. It has to survive the pane's *view* changing, so that
   * reordering the row doesn't tear down and remount a live editor — which
   * would lose its undo history and scroll position.
   */
  key: string
  view: PaneView
  /**
   * Pinned panes hold their note: opening something from the sidebar goes to
   * another pane, or opens a new one, rather than replacing what's here. It's
   * how you keep a reference note on one side while working through others.
   */
  pinned?: boolean
}

/** Three panes is the useful ceiling; past that panes are too narrow to write in. */
export const MAX_PANES = 3

/** Narrowest a pane can be dragged, in px — below this the note body has no room. */
export const PANE_MIN_PX = 220

let nextKey = 0

export function makePane(view: PaneView): Pane {
  nextKey += 1
  return { key: `pane-${nextKey}`, view }
}

/** Whether two views point at the same thing — one note must never have two live editors. */
export function sameView(a: PaneView, b: PaneView): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'note' && b.kind === 'note' ? a.id === b.id : true
}
