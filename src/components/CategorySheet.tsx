import { useEffect, useState } from 'react'
import { GENERAL_CATEGORY_ID } from '../types'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'
import { CATEGORY_ICONS, PICK_COLORS } from './icons'
import { ConfirmButton, Sheet } from './ui'

/** Creazione e modifica di una categoria: solo il Capofamiglia ci arriva. */
export function CategorySheet() {
  const { categorySheet, openCategorySheet, showToast } = useUi()
  const { session, saveCategory, deleteCategory, isOwner } = useVault()
  const existing = categorySheet?.id ? session?.common.categories.find((c) => c.id === categorySheet.id && !c.deleted) : undefined
  const [name, setName] = useState(''); const [icon, setIcon] = useState('Folder'); const [color, setColor] = useState(PICK_COLORS[0])
  useEffect(() => {
    if (!categorySheet) return
    setName(existing?.name ?? ''); setIcon(existing?.icon ?? 'Folder'); setColor(existing?.color ?? PICK_COLORS[0])
  }, [categorySheet, existing])
  const close = () => openCategorySheet(null)
  if (!isOwner) return null
  return (
    <Sheet open={!!categorySheet} onClose={close} title={existing ? 'Modifica categoria' : 'Nuova categoria'}>
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; saveCategory({ id: existing?.id, name, icon, color }); showToast('Categoria salvata'); close() }}>
        <label className="label !mt-1" htmlFor="cn">Nome</label>
        <input id="cn" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Scuola" autoFocus />
        <label className="label">Icona</label>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(CATEGORY_ICONS).map(([k, I]) => (
            <button key={k} type="button" aria-label={k} aria-pressed={icon === k} onClick={() => setIcon(k)} className={`flex h-11 items-center justify-center rounded-2xl border transition active:scale-90 ${icon === k ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted'}`}><I size={20} /></button>
          ))}
        </div>
        <label className="label">Colore del badge</label>
        <div className="flex flex-wrap gap-2.5">
          {PICK_COLORS.map((c) => <button key={c} type="button" aria-label={`Colore ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`h-9 w-9 rounded-full transition active:scale-90 ${color === c ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c }} />)}
        </div>
        <div className="mt-5 flex gap-2">
          {existing && existing.id !== GENERAL_CATEGORY_ID && <ConfirmButton label="Elimina" className="flex-1" onConfirm={() => { deleteCategory(existing.id); showToast('Categoria eliminata: le voci sono passate a «Generale»'); close() }} />}
          <button type="submit" className="glass-btn btn-primary flex-[2] !py-3" disabled={!name.trim()}>Salva</button>
        </div>
        {existing?.id === GENERAL_CATEGORY_ID && <p className="mt-2 px-1 text-xs text-muted">«Generale» raccoglie le voci senza categoria e non si può eliminare.</p>}
      </form>
    </Sheet>
  )
}
