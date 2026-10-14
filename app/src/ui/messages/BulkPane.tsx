import { AddIcon, Alert, Button, Card, CardContent, SegmentedControl, TextArea, TextField } from '@fanvue/ui'
import { useState } from 'react'
import type { MassInput } from '../../api'
import { useDispatch } from '../../hooks/useAccounts'
import { useVault } from '../../hooks/useContent'
import { useMassMessages } from '../../hooks/useMessages'
import { count, errorText, money } from '../format'
import { MediaTile } from '../MediaTile'
import { VaultPickerDialog } from '../VaultPickerDialog'

const AUDIENCES = [
  { value: 'all', label: 'All subscribers' },
  { value: 'regulars', label: 'Regulars only' },
]

/** Fanzly's "Bulk Message": one message to many fans; results come in over the next days. */
export function BulkPane({ accountId }: { accountId: string }) {
  const dispatch = useDispatch()
  const { data: vault = [] } = useVault(accountId)
  const { data: history = [] } = useMassMessages(accountId)
  const [text, setText] = useState('')
  const [audience, setAudience] = useState<MassInput['audience']>('all')
  const [attached, setAttached] = useState<string[]>([])
  const [price, setPrice] = useState('9.99')
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const send = () => {
    setMessage(null)
    dispatch
      .mutateAsync({
        type: 'mass.send',
        id: accountId,
        message: { text, audience, ...(attached.length ? { ppv: { vaultIds: attached, priceCents: Math.round(Number(price) * 100) } } : {}) },
      })
      .then(() => {
        setText('')
        setAttached([])
        setMessage({ ok: true, text: 'Sent. Opens and purchases come in over the next days; a few regulars may answer in their chats.' })
      })
      .catch((e) => setMessage({ ok: false, text: errorText(e) }))
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <SegmentedControl options={AUDIENCES} value={audience} onChange={(v) => setAudience(v as MassInput['audience'])} />
          <TextArea label="Message" minRows={3} fullWidth value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-end gap-2">
            {attached.map((id) => (
              <div key={id} className="w-16">
                <MediaTile item={vault.find((v) => v.id === id) ?? null} onClick={() => setAttached(attached.filter((x) => x !== id))} />
              </div>
            ))}
            <Button variant="secondary" size="32" leftIcon={<AddIcon />} onClick={() => setPicking(true)}>
              Paid content
            </Button>
            {attached.length > 0 && (
              <TextField label="Price (USD)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-32" />
            )}
          </div>
          {message && <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
          <Button variant="brand" loading={dispatch.isPending} onClick={send}>
            Send to {audience === 'all' ? 'all subscribers' : 'regulars'}
          </Button>
        </CardContent>
      </Card>

      {history.length > 0 && <h2 className="typography-body-default-16px-semibold">Sent</h2>}
      {history.map((m) => (
        <Card key={m.id}>
          <CardContent className="flex flex-col gap-1">
            <div className="text-xs text-content-tertiary">
              Day {m.day} · {m.audience === 'all' ? 'all subscribers' : 'regulars'}
              {m.ppv ? ` · paid ${money(m.ppv.priceCents)}` : ''}
            </div>
            <p className="line-clamp-2">{m.text || '(no text)'}</p>
            <div className="text-sm text-content-secondary">
              Sent {count(m.stats.sent)} · viewed {count(m.stats.views)}
              {m.ppv ? ` · unlocked ${count(m.stats.purchases)} · ${money(m.stats.earned)}` : ''}
            </div>
          </CardContent>
        </Card>
      ))}

      <VaultPickerDialog open={picking} onOpenChange={setPicking} vault={vault} selected={attached} onChange={setAttached} />
    </div>
  )
}
