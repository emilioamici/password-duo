import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { ChevronDown, Eye, EyeOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MemberRec } from '../types'
import { estimateStrength } from '../services/cryptoService'

export function Avatar({ member, size = 32 }: { member?: Pick<MemberRec, 'avatar' | 'color'> | null; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-surface shadow-sm" style={{ width: size, height: size, background: member?.color ?? '#cbd5e1', fontSize: size * 0.55 }}>
      {member?.avatar ?? '👤'}
    </span>
  )
}

/** Barra di robustezza: stessi token del resto dell'app (rosso → verde con tonalità calcolata, come la barra di pulizia). */
export function StrengthBar({ password }: { password: string }) {
  const s = estimateStrength(password)
  const pct = password ? Math.max(6, Math.min(100, (s.bits / 100) * 100)) : 0
  const hue = Math.round((Math.min(100, pct) / 100) * 140)
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-line">
        <motion.div className="h-full rounded-full" initial={false} animate={{ width: `${pct}%`, backgroundColor: `hsl(${hue} 58% 48%)` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>
      <p className="mt-1 text-xs text-muted">{password ? `${s.label} · circa ${s.bits} bit` : 'Nessuna password'}</p>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="relative flex rounded-full border border-line bg-line/40 p-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className="relative flex-1 rounded-full whitespace-nowrap px-3 py-1.5 text-sm font-semibold transition active:scale-95">
          {value === o.id && (
            <motion.span layoutId={`seg-${options.map((x) => x.id).join('-')}`} className="absolute inset-0 rounded-full bg-surface shadow-[0_2px_8px_rgb(var(--ink)/0.15)]" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
          )}
          <span className={`relative ${value === o.id ? '' : 'text-muted'}`}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, right, left }: { title: string; subtitle?: string; right?: ReactNode; left?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 pb-4 pt-2">
      <div className="flex min-w-0 items-center gap-2">
        {left}
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </header>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const controls = useDragControls()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:absolute">
          <motion.div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog" aria-label={title}
            className="glass-strong relative z-10 flex max-h-[92%] w-full max-w-md flex-col rounded-b-none"
            initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y" dragControls={controls} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose() }}
          >
            <div className="flex cursor-grab touch-none justify-center pb-1 pt-3" onPointerDown={(e) => controls.start(e)}><div className="h-1.5 w-10 rounded-full bg-muted/50" /></div>
            <div className="flex items-center justify-between px-5 pb-1">
              <h2 className="text-xl font-bold">{title}</h2>
              <button onClick={onClose} className="glass-btn !p-2" aria-label="Chiudi"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto px-5 pb-8 pt-1 pb-safe">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-1 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** Scheda a scomparsa: da chiusa mostra titolo e riepilogo, aperta anche il dettaglio. */
export function Accordion({ title, summary, icon, open, onToggle, children }: {
  title: string; summary?: ReactNode; icon: ReactNode; open: boolean; onToggle: () => void; children: ReactNode
}) {
  return (
    <section className="card overflow-hidden" data-open={open || undefined}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left active:bg-line/30">
        <span className="text-brand">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {summary && !open && <span className="block truncate text-xs text-muted">{summary}</span>}
        </span>
        <ChevronDown size={20} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line/60 p-4">{children}</div>}
    </section>
  )
}

/** Pulsante a due tocchi per le azioni distruttive: «Elimina» → «Tocca ancora per confermare». */
export function ConfirmButton({ label, confirmLabel = 'Tocca ancora per confermare', onConfirm, className = '', icon }: { label: string; confirmLabel?: string; onConfirm: () => void; className?: string; icon?: ReactNode }) {
  const [armed, setArmed] = useState(false)
  const t = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(t.current), [])
  return (
    <button type="button" className={`glass-btn btn-danger ${className}`} onClick={() => {
      if (armed) { window.clearTimeout(t.current); setArmed(false); onConfirm(); return }
      setArmed(true); t.current = window.setTimeout(() => setArmed(false), 3500)
    }}>
      {icon}{armed ? confirmLabel : label}
    </button>
  )
}

/** Campo password con mostra/nascondi. */
export function PasswordInput({ value, onChange, placeholder, autoComplete = 'off', mono = false, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; mono?: boolean; ariaLabel?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input className={`field !pr-11 ${mono && show ? 'font-mono' : ''}`} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={ariaLabel} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Nascondi password' : 'Mostra password'} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted active:scale-90">
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
