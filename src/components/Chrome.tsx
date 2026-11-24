import { AnimatePresence, motion } from 'framer-motion'
import { Cloud, CloudCheck, CloudOff, Dices, Loader2, Lock, Plus, RefreshCw, Tags, TriangleAlert, Users, Vault } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TabId } from '../types'
import { useVault } from '../store/VaultContext'
import { useUi } from '../store/UiContext'

/** Sfondo fisso: tre blob sfocati che fluttuano lenti (solo `transform`). È ciò che il vetro sfoca. */
export function Background() {
  const blob = (v: string) => ({ background: `rgb(var(--${v}))` })
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="absolute -left-24 -top-24 h-96 w-96 animate-float1 rounded-full blur-3xl" style={blob('blob-a')} />
      <div className="absolute -right-32 top-1/4 h-[28rem] w-[28rem] animate-float2 rounded-full blur-3xl" style={blob('blob-b')} />
      <div className="absolute -bottom-32 left-1/4 h-[30rem] w-[30rem] animate-float3 rounded-full blur-3xl" style={blob('blob-c')} />
    </div>
  )
}

/** Pulsante flottante «+». Disegnato nello strato fisso della schermata (le pagine hanno animazioni con blur che altrimenti lo farebbero scorrere). */
export function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => setHost(document.getElementById('shell-overlay')), [])
  if (!host) return null
  return createPortal(
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick} aria-label={label}
      className="glass-btn btn-primary pointer-events-auto absolute right-5 !h-14 !w-14 !p-0"
      style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}>
      <Plus size={26} strokeWidth={2.6} />
    </motion.button>,
    host,
  )
}

const TABS: { id: TabId; label: string; icon: typeof Vault }[] = [
  { id: 'vault', label: 'Cassaforte', icon: Vault },
  { id: 'generator', label: 'Generatore', icon: Dices },
  { id: 'categories', label: 'Categorie', icon: Tags },
  { id: 'family', label: 'Famiglia', icon: Users },
]

export function BottomNav() {
  const { tab, setTab } = useUi()
  return (
    <nav className="glass absolute inset-x-4 bottom-4 z-40 flex items-center justify-between !rounded-full p-1.5" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id
        return (
          <button key={id} onClick={() => setTab(id)} aria-label={label} aria-current={active ? 'page' : undefined} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 transition active:scale-90">
            {active && <motion.span layoutId="nav-drop" className="glass-active absolute inset-0 rounded-full" transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.9 }} />}
            <span className={`relative ${active ? 'text-brand' : 'text-muted'}`}><Icon size={22} strokeWidth={active ? 2.6 : 2.1} /></span>
            <span className={`relative text-[10px] font-semibold ${active ? 'text-brand' : 'text-muted'}`}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'ora'
  if (s < 3600) return `${Math.floor(s / 60)} min fa`
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`
  return `${Math.floor(s / 86400)} g fa`
}

export function SyncPill() {
  const { status, syncNow, reconnect, meta } = useVault()
  if (meta.mode === 'local') {
    return <span className="glass-btn !px-3 !py-1.5 text-xs pointer-events-none"><CloudOff size={15} />Solo locale</span>
  }
  const map = {
    local: { icon: <CloudOff size={15} />, text: 'Solo locale', cls: '' },
    idle: { icon: meta.dirty ? <Cloud size={15} /> : <CloudCheck size={15} />, text: meta.lastSyncAt ? `Sync ${timeAgo(meta.lastSyncAt)}` : 'Sync', cls: 'text-inc' },
    syncing: { icon: <Loader2 size={15} className="animate-spin" />, text: 'Sync…', cls: '' },
    offline: { icon: <CloudOff size={15} />, text: 'Offline', cls: 'text-brand' },
    auth: { icon: <TriangleAlert size={15} />, text: 'Riconnetti', cls: 'text-exp' },
    error: { icon: <TriangleAlert size={15} />, text: 'Errore', cls: 'text-exp' },
  }[status]
  return (
    <button onClick={() => (status === 'auth' ? void reconnect() : void syncNow())} className={`glass-btn !px-3 !py-1.5 text-xs ${map.cls}`} aria-label="Sincronizza">
      {map.icon}{map.text}
      {status !== 'syncing' && status !== 'auth' && <RefreshCw size={12} className="opacity-60" />}
    </button>
  )
}

export function LockButton() {
  const { lock } = useVault()
  return <button onClick={() => void lock()} className="glass-btn !p-2.5" aria-label="Blocca ora"><Lock size={20} /></button>
}

export function Toast() {
  const { toast } = useUi()
  return (
    <AnimatePresence>
      {toast && (
        <motion.div role="status" initial={{ opacity: 0, y: -20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95 }}
          className="glass-strong pointer-events-none absolute inset-x-6 top-4 z-[70] px-4 py-3 text-center text-sm font-semibold" style={{ marginTop: 'env(safe-area-inset-top)' }}>
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
