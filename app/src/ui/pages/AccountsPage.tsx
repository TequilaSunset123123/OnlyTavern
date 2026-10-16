import {
  AddIcon,
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DownloadIcon,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  TextField,
  TrashIcon,
  UploadIcon,
} from '@fanvue/ui'
import { type ChangeEvent, useRef, useState } from 'react'
import type { AccountSummary, DirectionId } from '../../api'
import { useAccounts, useDispatch, useExportAccount } from '../../hooks/useAccounts'
import { useDirectionOptions } from '../../hooks/useMessages'
import { PageTitle } from '../shell/PageTitle'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Accounts are like SillyTavern group chats: independent of any chat, you can have several (plan.md §1). */
export function AccountsPage() {
  const { data, isLoading } = useAccounts()
  const dispatch = useDispatch()
  const exportAccount = useExportAccount()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<AccountSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.catch((e) => setError(message(e)))
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (file) run(file.text().then((json) => dispatch.mutateAsync({ type: 'account.import', json })))
  }

  const accounts = data?.accounts ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <PageTitle
        title="Accounts"
        actions={
          <>
            <Button variant="secondary" size="40" leftIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
              Import
            </Button>
            <Button variant="brand" size="40" leftIcon={<AddIcon />} onClick={() => setCreating(true)}>
              New account
            </Button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={onImport} />
          </>
        }
      />

      {error && (
        <Alert variant="error" title="Something went wrong" closable onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!isLoading && accounts.length === 0 && (
        <EmptyState
          title="No accounts yet"
          description="Create a creator account to start. Each account has its own fans, posts and earnings."
          primaryAction={
            <Button variant="brand" leftIcon={<AddIcon />} onClick={() => setCreating(true)}>
              New account
            </Button>
          }
        />
      )}

      {accounts.map((a) => {
        const active = a.id === data?.activeId
        return (
          <Card key={a.id}>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="mr-auto min-w-0">
                <div className="flex items-center gap-2">
                  <span className="typography-body-default-16px-semibold truncate">{a.name}</span>
                  {active && <Badge variant="brandLight">Active</Badge>}
                </div>
                <div className="text-content-tertiary truncate">@{a.handle}</div>
              </div>
              {!active && (
                <Button variant="secondary" size="32" onClick={() => run(dispatch.mutateAsync({ type: 'account.select', id: a.id }))}>
                  Switch
                </Button>
              )}
              <Button variant="tertiary" size="32" leftIcon={<DownloadIcon />} onClick={() => run(exportAccount.mutateAsync(a.id))}>
                Export
              </Button>
              <Button variant="tertiaryDestructive" size="32" leftIcon={<TrashIcon />} onClick={() => setDeleting(a)}>
                Delete
              </Button>
            </CardContent>
          </Card>
        )
      })}

      <NewAccountDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(name, handle, direction) => run(dispatch.mutateAsync({ type: 'account.create', name, handle, direction }).then(() => setCreating(false)))}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
          </DialogHeader>
          <DialogBody>This deletes the account and everything in it. Export it first if you want a backup.</DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const id = deleting!.id
                setDeleting(null)
                run(dispatch.mutateAsync({ type: 'account.delete', id }))
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NewAccountDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string, handle: string, direction: DirectionId) => void
}) {
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [direction, setDirection] = useState<DirectionId>('girl_next_door')
  const { data: directions = [] } = useDirectionOptions()
  const cleanHandle = handle.replace(/[^A-Za-z0-9_.]/g, '') // what OF allows in usernames, roughly
  const valid = name.trim() !== '' && cleanHandle !== ''

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setName('')
          setHandle('')
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onCreate(name.trim(), cleanHandle, direction)
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <TextField label="Handle" leftLabel="@" value={handle} onChange={(e) => setHandle(e.target.value)} />
            <Select label="Direction" value={direction} onValueChange={(v) => setDirection(v as DirectionId)} fullWidth>
              <SelectContent>
                {directions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-content-tertiary">
              {directions.find((d) => d.id === direction)?.blurb} You can switch later in My Profile, but part of your subscribers will leave.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="brand" type="submit" disabled={!valid}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
