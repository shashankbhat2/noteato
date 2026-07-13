import { createExtension } from '@blocknote/core'
import { Extension, InputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { NOTE_LINK_PREFIX } from '../../shared/noteLink'

// Typography-style replacements: typed arrow sequences become real arrows.
// Longer sequences come first so they win over their two-character tails.
// "<->" can never fully form ("<-" converts to "←" as soon as the "-" lands),
// so "←>" finishes the job for anyone typing it out.
const ARROW_RULES: { find: RegExp; char: string }[] = [
  { find: /-->$/, char: '⟶' },
  { find: /==>$/, char: '⟹' },
  { find: /->$/, char: '→' },
  { find: /=>$/, char: '⇒' },
  { find: /<-$/, char: '←' },
  { find: /←>$/, char: '↔' }
]

function inCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos)
  if ($pos.parent.type.spec.code) return true
  const codeMark = state.schema.marks.code
  return Boolean(codeMark && codeMark.isInSet($pos.marks()))
}

function arrowInputRule(find: RegExp, char: string): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range }) => {
      if (inCode(state, range.from)) return
      state.tr.insertText(char, range.from, range.to)
    }
  })
}

// Converts any plain link whose href is a stored note link ("#note/<id>") into
// an atomic noteLink mention chip. linkifyBlocks already does this when a note
// is loaded from markdown; this plugin covers every live path into the doc —
// pasting (markdown text or external HTML), drops, and AI edits — so page
// links stay page links wherever the content came from.
function noteLinkRestorePlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const noteLink = newState.schema.nodes.noteLink
      const linkMark = newState.schema.marks.link
      if (!noteLink || !linkMark) return null

      const tr = newState.tr
      let changed = false
      newState.doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return
        const mark = node.marks.find(
          (m) => m.type === linkMark && String(m.attrs.href ?? '').startsWith(NOTE_LINK_PREFIX)
        )
        if (!mark) return
        const mention = noteLink.create({
          noteId: String(mark.attrs.href).slice(NOTE_LINK_PREFIX.length),
          title: node.text || 'Untitled'
        })
        tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), mention)
        changed = true
      })
      return changed ? tr : null
    }
  })
}

// --- Find & replace ---------------------------------------------------------
// Plugin state holds the query and its matches; the find bar drives it with
// setMeta and reads it back after each dispatch. Decorations highlight all
// matches, with the active one styled distinctly.

export interface SearchMatch {
  from: number
  to: number
}

export interface SearchState {
  query: string
  matches: SearchMatch[]
  active: number
}

export const searchPluginKey = new PluginKey<SearchState>('noteatoSearch')

function findMatches(doc: PmNode, query: string): SearchMatch[] {
  const needle = query.toLowerCase()
  const matches: SearchMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // The placeholder keeps offsets aligned with PM positions across atoms
    // (mention chips and the like each occupy one position).
    const text = node.textBetween(0, node.content.size, undefined, '￼').toLowerCase()
    let index = text.indexOf(needle)
    while (index !== -1) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + needle.length })
      index = text.indexOf(needle, index + needle.length)
    }
    return false
  })
  return matches
}

function searchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchPluginKey,
    state: {
      init: () => ({ query: '', matches: [], active: 0 }),
      apply(tr, prev) {
        const meta = tr.getMeta(searchPluginKey) as Partial<SearchState> | undefined
        if (!meta && !tr.docChanged) return prev
        const query = meta?.query ?? prev.query
        const matches = query ? findMatches(tr.doc, query) : []
        let active = meta?.active ?? prev.active
        if (active >= matches.length) active = Math.max(0, matches.length - 1)
        return { query, matches, active }
      }
    },
    props: {
      decorations(state) {
        const search = searchPluginKey.getState(state)
        if (!search?.query || search.matches.length === 0) return DecorationSet.empty
        return DecorationSet.create(
          state.doc,
          search.matches.map((match, i) =>
            Decoration.inline(match.from, match.to, {
              class:
                i === search.active ? 'noteato-search-match active' : 'noteato-search-match'
            })
          )
        )
      }
    }
  })
}

// Typing `text` converts it to inline code (Notion-style). The closing
// backtick triggers the rule; the stored mark is cleared so typing continues
// unstyled after the snippet.
function inlineCodeInputRule(): InputRule {
  return new InputRule({
    find: /`([^`\s][^`]*)`$/,
    handler: ({ state, range, match }) => {
      if (inCode(state, range.from)) return
      const codeMark = state.schema.marks.code
      if (!codeMark) return
      const text = match[1]
      state.tr
        .insertText(text, range.from, range.to)
        .addMark(range.from, range.from + text.length, codeMark.create())
        .removeStoredMark(codeMark)
    }
  })
}

const ArrowsExtension = Extension.create({
  name: 'noteatoArrows',
  addInputRules() {
    return [...ARROW_RULES.map((rule) => arrowInputRule(rule.find, rule.char)), inlineCodeInputRule()]
  }
})

export const noteatoEditorExtension = createExtension({
  key: 'noteatoExtras',
  tiptapExtensions: [ArrowsExtension],
  prosemirrorPlugins: [noteLinkRestorePlugin(), searchPlugin()]
})
