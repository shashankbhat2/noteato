// Shared between the renderer (noteLink.tsx, which renders/parses these) and
// the main process (notionImport.ts, which writes them). A pure constant —
// no React/BlockNote deps — so it's safe to import from either side.
export const NOTE_LINK_PREFIX = '#note/'
