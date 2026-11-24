import { ChevronRight, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { listItems, liveCategories } from '../lib/entries'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { Fab, LockButton, SyncPill } from './Chrome'
import { iconFor } from './icons'
import { MascotPeek } from './Mascots'
import { PageHeader } from './ui'

export function CategoriesView() {
  const { session, file, isOwner } = useVault()
  const { openCategorySheet, setTab } = useUi()
  const cats = session ? liveCategories(session) : []
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    if (session && file) for (const i of listItems(session, file.members)) m.set(i.category.id, (m.get(i.category.id) ?? 0) + 1)
    return m
  }, [session, file])

  return (
    <>
      <PageHeader title="Categorie" subtitle={isOwner ? 'Le gestisci tu, per tutta la famiglia' : 'Condivise da tutta la famiglia'} right={<><SyncPill /><LockButton /></>} />
      <MascotPeek kind="mochi">
        <div className={`card flex items-center gap-3 p-4 ${isOwner ? '' : ''}`}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand"><ShieldCheck size={22} /></span>
          <div className="min-w-0">
            <p className="font-bold">{isOwner ? 'Sei il Capofamiglia' : 'Gestite dal Capofamiglia'}</p>
            <p className="text-xs text-muted">{isOwner ? 'Puoi aggiungere, rinominare ed eliminare le categorie. Le voci di una categoria eliminata passano a «Generale».' : 'Puoi usarle per ordinare le tue password, ma solo il Capofamiglia può modificarle.'}</p>
          </div>
        </div>
      </MascotPeek>

      <ul className="mt-3 space-y-3">
        {cats.map((c) => {
          const I = iconFor(c.icon)
          const n = counts.get(c.id) ?? 0
          const inner = (
            <>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-inner" style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}aa)` }}><I size={20} /></span>
              <span className="min-w-0 flex-1 text-left"><span className="block truncate font-semibold">{c.name}</span><span className="block text-xs text-muted">{n} {n === 1 ? 'voce' : 'voci'}</span></span>
              {isOwner && <ChevronRight size={18} className="text-muted" />}
            </>
          )
          return (
            <li key={c.id} className="card">
              {isOwner
                ? <button className="flex w-full items-center gap-3 p-3 active:bg-line/30" style={{ borderRadius: 'inherit' }} onClick={() => openCategorySheet({ id: c.id })} aria-label={`Modifica ${c.name}`}>{inner}</button>
                : <button className="flex w-full items-center gap-3 p-3" style={{ borderRadius: 'inherit' }} onClick={() => setTab('vault')} aria-label={c.name}>{inner}</button>}
            </li>
          )
        })}
      </ul>
      {isOwner && <Fab label="Nuova categoria" onClick={() => openCategorySheet({})} />}
    </>
  )
}
