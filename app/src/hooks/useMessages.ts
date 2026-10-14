// DMs (plan.md §8.1 Messages). The engine queues fan messages as 'pending'; this
// file has the hook that asks the model to write them, only for the conversation
// you are looking at (so you pay for what you read). If the model fails, openers
// fall back to a corpus line and replies show "Retry": nothing gets stuck.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, type ThreadView } from '../api'
import { writeFanMessage } from '../llm/fanMessage'
import { useDispatch } from './useAccounts'
import { useSettings } from './useContent'

export function useInbox(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'inbox'], queryFn: () => api.getInbox(id!), enabled: !!id })
}

export function useThread(id: string | null | undefined, regularId: string | undefined) {
  return useQuery({
    queryKey: ['account', id, 'thread', regularId],
    queryFn: () => api.getThread(id!, regularId!),
    enabled: !!id && !!regularId,
  })
}

export function useMassMessages(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'mass'], queryFn: () => api.getMassMessages(id!), enabled: !!id })
}

export type WriterState = { writing: string | null; failed: Record<string, string> }

/** Writes pending fan messages of the open conversation, one at a time, oldest first. */
export function useFanWriter(accountId: string, view: ThreadView | undefined) {
  const { mutateAsync } = useDispatch()
  const { data: settings } = useSettings()
  const [state, setState] = useState<WriterState>({ writing: null, failed: {} })
  const busy = useRef(false)
  // Written but maybe not refetched yet: never pay the model twice for one message.
  const done = useRef(new Set<string>())

  const pending = view?.messages.find((m) => m.state === 'pending' && !state.failed[m.id] && !done.current.has(m.id))

  useEffect(() => {
    if (!view || !pending || !settings || busy.current) return
    busy.current = true
    setState((s) => ({ ...s, writing: pending.id }))
    const regularId = view.regular.id
    writeFanMessage(view, pending.id, settings.connectionProfile)
      .then((text) => {
        done.current.add(pending.id)
        return mutateAsync({ type: 'dm.fill', id: accountId, regularId, messageId: pending.id, text })
      })
      .catch(async (e: unknown) => {
        if (pending.intent?.kind === 'opener') {
          done.current.add(pending.id)
          await mutateAsync({ type: 'dm.fallback', id: accountId, regularId, messageId: pending.id })
        } else {
          setState((s) => ({ ...s, failed: { ...s.failed, [pending.id]: e instanceof Error ? e.message : String(e) } }))
        }
      })
      .finally(() => {
        busy.current = false
        setState((s) => ({ ...s, writing: null }))
      })
  }, [view, pending, settings, accountId, mutateAsync])

  const retry = (messageId: string) =>
    setState((s) => {
      const { [messageId]: _, ...failed } = s.failed
      return { ...s, failed }
    })

  return { ...state, retry }
}
