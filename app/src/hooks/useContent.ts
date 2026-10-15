// Queries for step 3: vault, feed, comments, notifications, tags, settings.
// Account data hangs under ['account', id] so dispatches that touch the account refresh it.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export function useVault(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'vault'], queryFn: () => api.getVault(id!), enabled: !!id })
}

export function useFeed(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'feed'], queryFn: () => api.getFeed(id!), enabled: !!id })
}

export function useComments(id: string | null | undefined, postId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['account', id, 'comments', postId],
    queryFn: () => api.getComments(id!, postId),
    enabled: !!id && enabled,
  })
}

export function useNotifications(id: string | null | undefined) {
  return useQuery({ queryKey: ['account', id, 'notifications'], queryFn: () => api.getNotifications(id!), enabled: !!id })
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.getTags() })
}

export function useCaptions() {
  return useQuery({ queryKey: ['captions'], queryFn: () => api.getCaptions(), staleTime: Infinity })
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
}
