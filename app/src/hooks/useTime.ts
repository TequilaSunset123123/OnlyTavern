// Time passing (2026-10-15): stalker incidents waiting for a decision, and what would
// lapse if you skipped ahead. Under ['account', id] so any dispatch refreshes them.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export function useIncidents(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'incidents'], queryFn: () => api.getIncidents(id!), enabled: !!id })
}

/** Asks, right now, what would lapse if you skipped `days` ahead. */
export function useLapsingCheck() {
  const qc = useQueryClient()
  return (id: string, days: number) => qc.fetchQuery({ queryKey: ['account', id, 'lapsing', days], queryFn: () => api.getLapsing(id, days), staleTime: 0 })
}
