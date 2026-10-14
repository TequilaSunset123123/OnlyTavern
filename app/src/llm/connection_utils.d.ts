// Types for the copied connection_utils.js.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type ConnectionProfile = { id: string; name: string; model?: string; api?: string }

export function getProfileByName(profileName: string): Promise<ConnectionProfile | null>
export function generateWithProfile(
  profileName: string,
  messages: ChatMessage[],
  abortController?: AbortController | null,
  options?: { maxTokens?: number | null; includePreset?: boolean; includeInstruct?: boolean },
): Promise<string>
