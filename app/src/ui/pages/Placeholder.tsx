import { EmptyState } from '@fanvue/ui'

/** Empty page for step 0; each page gets real content in its own step (plan.md §10). */
export function Placeholder({ title, step }: { title: string; step: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <EmptyState title={title} description={`Coming in ${step}.`} />
    </div>
  )
}
