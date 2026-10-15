import type { DeliveryReason } from '../../api'

/** Why a fan did not pay for a delivered custom (the engine's reason, in words). */
export const NOT_PAID: Record<DeliveryReason, string> = {
  liked: '',
  tags: 'not what they asked for',
  tame: 'tamer than they asked for',
  explicit: 'more explicit than they wanted',
  reused: 'they had seen it before',
}
