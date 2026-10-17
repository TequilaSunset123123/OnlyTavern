// Time passing (2026-10-15): stalker incidents and rare daily events waiting for a
// decision, today's event, and what would lapse if you skipped ahead. Under
// ['account', id] so any dispatch refreshes them.
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

/** Today's event for the Home card (engine/events.ts). */
export function useTodaysEvent(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'todaysEvent'], queryFn: () => api.getTodaysEvent(id!), enabled: !!id })
}

/** Rare events waiting for your choice. */
export function useOpenDayEvents(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'openDayEvents'], queryFn: () => api.getOpenDayEvents(id!), enabled: !!id })
}
