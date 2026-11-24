import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Search, User } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Scope } from '../types'
import { copyText } from '../lib/clipboard'
import { listItems, liveCategories, type Item } from '../lib/entries'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { Fab, LockButton, SyncPill } from './Chrome'
import { autoColor, iconFor } from './icons'
import { MascotImg, MascotPeek } from './Mascots'
import { PageHeader, Segmented } from './ui'

type Filter = 'all' | Scope

function EntryCard({ item }: { item: Item }) {
  const { openEntrySheet, showToast } = useUi()
  const { prefs } = useVault()
  const { entry: e, category: c } = item
  const color = e.color ?? autoColor(e.title)
  const Icon = iconFor(c.icon)
  const copy = async (what: string, v: string) => {
    const ok = await copyText(v, prefs.clearClipboard)
    showToast(ok ? `${what} copiato${what === 'Password' && prefs.clearClipboard ? ' · appunti svuotati tra 30 s' : ''}` : 'Copia non riuscita')
  }
  return (
    <motion.li layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 90, scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }} className="card p-3">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => openEntrySheet({ id: e.id })} aria-label={`Apri ${e.title}`}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold text-white shadow-inner" style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}>
          {e.title.trim().charAt(0).toUpperCase() || <Icon size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold leading-tight">{e.title}</span>
          <span className="block truncate text-xs text-muted">{e.username || 'Nessun username'}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-line/70 px-2 py-0.5 text-[11px] font-semibold text-muted"><Icon size={11} />{c.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.scope === 'common' ? 'bg-brand/10 text-brand' : 'bg-line/70 text-muted'}`}>{item.scope === 'common' ? 'Comune' : 'Personale'}</span>
          </span>
        </span>
      </button>
      <div className="mt-2 flex gap-2">
        <button className="chip flex-1 justify-center" onClick={() => void copy('Username', e.username)} disabled={!e.username}><User size={14} />Copia User</button>
        <button className="chip flex-1 justify-center" onClick={() => void copy('Password', e.password)} disabled={!e.password}><KeyRound size={14} />Copia Pass</button>
      </div>
    </motion.li>
  )
}

export function VaultView() {
  const { session, file } = useVault()
  const { openEntrySheet } = useUi()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [cat, setCat] = useState<string>('all')

  const items = useMemo(() => (session && file ? listItems(session, file.members) : []), [session, file])
  const cats = session ? liveCategories(session) : []
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return items.filter((i) =>
      (filter === 'all' || i.scope === filter) && (cat === 'all' || i.category.id === cat) &&
      (!t || i.entry.title.toLowerCase().includes(t) || i.entry.username.toLowerCase().includes(t) || i.entry.url.toLowerCase().includes(t)))
  }, [items, q, filter, cat])
  const nCommon = items.filter((i) => i.scope === 'common').length

  return (
    <>
      <PageHeader title="Cassaforte" subtitle={file?.houseName} right={<><SyncPill /><LockButton /></>} />
      <MascotPeek kind="mochi">
        <div className="card p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-4xl font-extrabold leading-none" data-testid="count">{items.length}</p>
              <p className="mt-1 text-sm text-muted">password · {nCommon} comuni, {items.length - nCommon} personali</p>
            </div>
          </div>
          <div className="relative mt-3">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="field !pl-10" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca titolo, username, sito…" aria-label="Cerca" autoCapitalize="none" autoCorrect="off" />
          </div>
          <div className="mt-3"><Segmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'all', label: 'Tutte' }, { id: 'common', label: 'Comuni' }, { id: 'personal', label: 'Personali' }]} /></div>
        </div>
      </MascotPeek>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <button className={`chip ${cat === 'all' ? 'chip-active' : ''}`} onClick={() => setCat('all')}>Tutte le categorie</button>
        {cats.map((c) => { const I = iconFor(c.icon); return <button key={c.id} className={`chip ${cat === c.id ? 'chip-active' : ''}`} onClick={() => setCat(c.id)}><I size={14} />{c.name}</button> })}
      </div>

      {shown.length === 0 ? (
        <div className="card mt-3 py-8 text-center">
          <MascotImg kind="zenitsu" className="mx-auto h-20 w-auto" />
          <p className="mt-2 font-bold">{items.length === 0 ? 'La cassaforte è vuota' : 'Nessun risultato'}</p>
          <p className="text-sm text-muted">{items.length === 0 ? 'Tocca + per aggiungere la prima password.' : 'Prova con un’altra ricerca o un altro filtro.'}</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          <AnimatePresence initial={false}>{shown.map((i) => <EntryCard key={i.entry.id} item={i} />)}</AnimatePresence>
        </ul>
      )}
      <Fab label="Nuova voce" onClick={() => openEntrySheet({ scope: filter === 'common' ? 'common' : 'personal' })} />
    </>
  )
}
