import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { Scope, TabId } from '../types'

export interface EntrySheetState { id?: string; scope?: Scope; /** password da precompilare (dal generatore) */ password?: string }

interface UiCtx {
  tab: TabId
  setTab: (t: TabId) => void
  entrySheet: EntrySheetState | null
  openEntrySheet: (s: EntrySheetState | null) => void
  categorySheet: { id?: string } | null
  openCategorySheet: (s: { id?: string } | null) => void
  importOpen: boolean
  openImport: (o: boolean) => void
  toast: string
  showToast: (m: string) => void
}

const Ctx = createContext<UiCtx | null>(null)
export function useUi(): UiCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUi fuori da UiProvider')
  return c
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<TabId>('vault')
  const [entrySheet, openEntrySheet] = useState<EntrySheetState | null>(null)
  const [categorySheet, openCategorySheet] = useState<{ id?: string } | null>(null)
  const [importOpen, openImport] = useState(false)
  const [toast, setToast] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const showToast = useCallback((m: string) => {
    setToast(m); window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(''), 3200)
  }, [])
  return <Ctx.Provider value={{ tab, setTab, entrySheet, openEntrySheet, categorySheet, openCategorySheet, importOpen, openImport, toast, showToast }}>{children}</Ctx.Provider>
}
