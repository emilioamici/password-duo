import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { Background, BottomNav, Toast } from './components/Chrome'
import { CategoriesView } from './components/CategoriesView'
import { CategorySheet } from './components/CategorySheet'
import { EntrySheet } from './components/EntrySheet'
import { FamilyView } from './components/FamilyView'
import { Gate } from './components/Gate'
import { GeneratorView } from './components/GeneratorView'
import { ImportSheet } from './components/ImportSheet'
import { UnlockScreen } from './components/UnlockScreen'
import { VaultView } from './components/VaultView'
import { useUi } from './store/UiContext'
import { useVault } from './store/VaultContext'

export default function App() {
  const { tab } = useUi()
  const { ready, file, session, meta, status, offlineSkipped } = useVault()
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [tab, !!session])

  // prima pagina (nessuna cassaforte) → accesso; sessione Google scaduta → riaccesso; bloccata → sblocco; altrimenti l'app
  const gate: 'login' | 'reconnect' | null = !file ? 'login' : meta.mode === 'drive' && status === 'auth' && !offlineSkipped ? 'reconnect' : null
  const unlocking = !gate && !session

  return (
    <>
      <Background />
      <div className="mx-auto flex h-full max-w-md items-stretch md:items-center">
        <div className="relative h-full w-full overflow-hidden md:h-[min(52rem,calc(100dvh-2rem))] md:rounded-[2.75rem] md:border md:border-line md:shadow-[0_40px_100px_-20px_rgb(var(--glass-shade))]">
          <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-4 pt-safe pb-32">
            {!ready ? (
              <div className="flex h-full items-center justify-center text-sm text-muted" role="status">Caricamento…</div>
            ) : gate ? (
              <Gate key={gate} reconnect={gate === 'reconnect'} />
            ) : unlocking ? (
              <UnlockScreen />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }} transition={{ duration: 0.18 }} className="pt-4">
                  {tab === 'vault' && <VaultView />}
                  {tab === 'generator' && <GeneratorView />}
                  {tab === 'categories' && <CategoriesView />}
                  {tab === 'family' && <FamilyView />}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
          <div id="shell-overlay" className="pointer-events-none absolute inset-0 z-30" />
          {session && !gate && <BottomNav />}
          {session && <><EntrySheet /><CategorySheet /><ImportSheet /></>}
          <Toast />
        </div>
      </div>
    </>
  )
}
