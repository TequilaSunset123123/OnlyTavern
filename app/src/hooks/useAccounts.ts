// TanStack Query hooks over api (plan.md §9: components call hooks, hooks call api).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Action, api, type Topic } from '../api'
import { downloadText } from '../bridge/st'

// 'settings' refreshes everything: e.g. comments depend on the fan language.
const topicKey = (t: Topic) =>
  t === 'accounts' ? ['accounts'] : t === 'settings' ? [] : ['account', t.slice('account:'.length)]

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.listAccounts() })
}

export function useAccount(id: string | null | undefined) {
  return useQuery({
    queryKey: ['account', id],
    queryFn: () => api.getAccount(id!),
    enabled: !!id,
  })
}

/** The active account's summary (from the index), or null when there is none. */
export function useActiveAccount() {
  const { data, ...rest } = useAccounts()
  const active = data?.accounts.find((a) => a.id === data.activeId) ?? null
  return { ...rest, data: active }
}

export function useDispatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: Action) => api.dispatch(action),
    onSuccess: async (result) => {
      await Promise.all(result.delta.map((t) => qc.invalidateQueries({ queryKey: topicKey(t) })))
    },
  })
}

export function useExportAccount() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { fileName, json } = await api.exportAccount(id)
      await downloadText(fileName, json)
    },
  })
}

// Statements / Statistics hang under ['account', id], so any action that touches
// the account (clock.advance, payout.request, ...) refreshes them too.
export function useStatements(id: string | null | undefined) {
  return useQuery({
    queryKey: ['account', id, 'statements'],
    queryFn: () => api.getStatements(id!),
    enabled: !!id,
  })
}

export function useStatistics(id: string | null | undefined) {
  return useQuery({
    queryKey: ['account', id, 'statistics'],
    queryFn: () => api.getStatistics(id!),
    enabled: !!id,
  })
}
