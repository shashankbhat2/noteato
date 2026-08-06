export type HomeChatRole = 'user' | 'assistant'

export interface HomeChatMessage {
  id: string
  role: HomeChatRole
  content: string
  createdAt: string
}

export interface HomeChatThread {
  id: string
  title: string
  messages: HomeChatMessage[]
  createdAt: string
  updatedAt: string
}

export type HomeChatThreadSummary = Omit<HomeChatThread, 'messages'> & { preview: string }
