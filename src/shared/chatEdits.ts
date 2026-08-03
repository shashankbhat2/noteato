const EDIT_OPEN = '<noteato-edit>'
const EDIT_CLOSE = '</noteato-edit>'

export interface ParsedChatOutput {
  message: string
  proposedMarkdown: string | null
  hasEditMarker: boolean
}

function unwrapMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  return match ? match[1].trim() : trimmed
}

export function parseChatOutput(output: string): ParsedChatOutput {
  const openIndex = output.indexOf(EDIT_OPEN)
  if (openIndex === -1) {
    return { message: output.trim(), proposedMarkdown: null, hasEditMarker: false }
  }

  const message = output.slice(0, openIndex).trim()
  const editStart = openIndex + EDIT_OPEN.length
  const closeIndex = output.indexOf(EDIT_CLOSE, editStart)
  if (closeIndex === -1) {
    return { message, proposedMarkdown: null, hasEditMarker: true }
  }

  const proposedMarkdown = unwrapMarkdownFence(output.slice(editStart, closeIndex))
  return {
    message,
    proposedMarkdown: proposedMarkdown || null,
    hasEditMarker: true
  }
}
