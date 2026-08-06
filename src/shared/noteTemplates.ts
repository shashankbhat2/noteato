export interface NoteTemplateDraft {
  name: string
  description: string
  titlePattern: string
  markdown: string
  sourceNoteId?: string
}

export interface NoteTemplate extends NoteTemplateDraft {
  id: string
  createdAt: string
  updatedAt: string
}

export interface ParsedTemplateOutput {
  message: string
  draft: NoteTemplateDraft | null
  hasTemplateMarker: boolean
}

export interface ParsedNewNoteOutput {
  message: string
  note: { title: string; markdown: string } | null
  hasNoteMarker: boolean
}

const TEMPLATE_OPEN = '<noteato-template>'
const TEMPLATE_CLOSE = '</noteato-template>'
const NOTE_OPEN = '<noteato-note>'
const NOTE_CLOSE = '</noteato-note>'

function tagged(source: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i').exec(source)
  return match?.[1]?.trim() || null
}

function beforeFirstMarker(output: string): string {
  const indexes = [output.indexOf(TEMPLATE_OPEN), output.indexOf(NOTE_OPEN), output.indexOf('<noteato-edit>')]
    .filter((index) => index >= 0)
  return output.slice(0, indexes.length > 0 ? Math.min(...indexes) : output.length).trim()
}

export function visibleAgentMessage(output: string): string {
  return beforeFirstMarker(output)
}

export function parseTemplateOutput(output: string): ParsedTemplateOutput {
  const start = output.indexOf(TEMPLATE_OPEN)
  if (start === -1) {
    return { message: beforeFirstMarker(output), draft: null, hasTemplateMarker: false }
  }
  const end = output.indexOf(TEMPLATE_CLOSE, start + TEMPLATE_OPEN.length)
  if (end === -1) {
    return { message: beforeFirstMarker(output), draft: null, hasTemplateMarker: true }
  }

  const artifact = output.slice(start + TEMPLATE_OPEN.length, end)
  const name = tagged(artifact, 'name')
  const description = tagged(artifact, 'description') ?? ''
  const titlePattern = tagged(artifact, 'title')
  const markdown = tagged(artifact, 'content')
  return {
    message: beforeFirstMarker(output),
    draft:
      name && titlePattern && markdown
        ? { name, description, titlePattern, markdown }
        : null,
    hasTemplateMarker: true
  }
}

export function parseNewNoteOutput(output: string): ParsedNewNoteOutput {
  const start = output.indexOf(NOTE_OPEN)
  if (start === -1) {
    return { message: beforeFirstMarker(output), note: null, hasNoteMarker: false }
  }
  const end = output.indexOf(NOTE_CLOSE, start + NOTE_OPEN.length)
  if (end === -1) {
    return { message: beforeFirstMarker(output), note: null, hasNoteMarker: true }
  }
  const artifact = output.slice(start + NOTE_OPEN.length, end)
  const title = tagged(artifact, 'title')
  const markdown = tagged(artifact, 'content')
  return {
    message: beforeFirstMarker(output),
    note: title && markdown ? { title, markdown } : null,
    hasNoteMarker: true
  }
}

export function resolveTemplateVariables(value: string, now = new Date()): string {
  const replacements: Record<string, string> = {
    date: now.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    month: now.toLocaleDateString(undefined, { month: 'long' }),
    year: String(now.getFullYear())
  }
  return value.replace(/\{\{(date|time|weekday|month|year)\}\}/gi, (_, key: string) =>
    replacements[key.toLowerCase()] ?? ''
  )
}

export const NOTE_TEMPLATE_INSTRUCTIONS = `
When the user explicitly asks to turn the current note into, create, or save a reusable template, do not edit the source note. Briefly state what you are about to create without claiming it is already saved, then output exactly one complete artifact using this format:
<noteato-template>
<name>Short template name</name>
<description>One concise description</description>
<title>Reusable note title, optionally containing {{date}}, {{time}}, {{weekday}}, {{month}}, or {{year}}</title>
<content>
Complete reusable Markdown
</content>
</noteato-template>

Preserve the useful headings, formatting, checklists and recurring structure. Remove facts specific to this instance and replace dates only with the supported variables. Leave blank prompts, bullets, or checkboxes where the next note should be filled in. Never put the artifact in a code fence.`

export const HOME_AGENT_INSTRUCTIONS = `You are the creation assistant on Noteato's Home screen. Be concise and useful. You can answer normally, create reusable note templates, or create a new note.

${NOTE_TEMPLATE_INSTRUCTIONS}

When the user explicitly asks you to create and save a new note, briefly state what you will create without claiming it is already created, then output exactly one complete artifact:
<noteato-note>
<title>Note title</title>
<content>
# Note title

Complete Markdown
</content>
</noteato-note>

The app performs actions only after receiving a complete artifact. Never claim an action succeeded before then.`
