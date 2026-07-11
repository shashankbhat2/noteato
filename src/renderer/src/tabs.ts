export interface Tab {
  /** The note's stable id (never changes, unlike its path which can be renamed/moved). */
  id: string
  /** Relative path used to (re)load the editor's content; updated if the note is moved. */
  path: string
  title: string
  /** Pinned tabs stay at the front of the strip and survive bulk-close actions. */
  pinned?: boolean
}
