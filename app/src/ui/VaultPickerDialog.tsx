import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, EmptyState } from '@fanvue/ui'
import { useNavigate } from 'react-router'
import type { VaultItem } from '../api'
import { MediaTile } from './MediaTile'

/** Pick vault items to attach (posts, paid messages, mass messages). */
export function VaultPickerDialog({
  open,
  onOpenChange,
  vault,
  selected,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  vault: VaultItem[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const navigate = useNavigate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add from vault</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {vault.length === 0 ? (
            <EmptyState
              title="Your vault is empty"
              description="Add items in the Vault first."
              primaryAction={<Button onClick={() => navigate('/vault')}>Open vault</Button>}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {vault.map((v) => (
                <MediaTile
                  key={v.id}
                  item={v}
                  selected={selected.includes(v.id)}
                  onClick={() => onChange(selected.includes(v.id) ? selected.filter((id) => id !== v.id) : [...selected, v.id])}
                />
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" onClick={() => onOpenChange(false)}>
            Done ({selected.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
