/**
 * Stato dell'app: file cifrato (sempre cifrato), sessione sbloccata (solo in memoria), sincronizzazione con Drive,
 * blocco automatico e identità.
 *
 * Regole di sicurezza che questo file fa rispettare:
 * - la copia locale e quella su Drive sono SEMPRE testo cifrato: ogni modifica ricifra subito il blocco interessato;
 * - il blocco (manuale o automatico) butta chiavi e dati in chiaro, ma prima aspetta che le modifiche siano state ricifrate;
 * - non si carica mai su Drive se la copia locale non è allineata (cache persa) o se il blocco comune non si apre con la chiave in memoria.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  GENERAL_CATEGORY_ID, type Category, type Entry, type Prefs, type Scope, type VaultFile,
} from '../types'
import { uid } from '../services/cryptoService'
import {
  AVATARS, KeyMismatchError, MEMBER_COLORS, activeMembers, canEditCommon, changeFamilyPassword, changePersonalSecret, createVault,
  makeMember, mergeFiles, parseVault, recoverFromStash, removeMember, reopen, sameFile, sealFile, tombstoneCategory, tombstoneEntry, unlockVault,
  upsertMember, type Session,
} from '../services/vaultModel'
import * as drive from '../services/googleDriveService'
import { hasSession } from '../services/broker'
import { clearInvite, inviteLink } from '../services/invite'
import { loadCache, loadStash, saveCache, saveStash } from '../services/cache'

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'auth' | 'error'
export interface Meta {
  mode: 'none' | 'local' | 'drive'
  fileId: string
  /** `version` di Drive dell'ultima copia letta/scritta */
  version: string
  dirty: boolean
  lastSyncAt: number
  memberId: string
  ownerEmail: string
  canShare: boolean
}
const EMPTY_META: Meta = { mode: 'none', fileId: '', version: '', dirty: false, lastSyncAt: 0, memberId: '', ownerEmail: '', canShare: false }
const META_KEY = 'pwduo:sync'
const PREFS_KEY = 'pwduo:prefs'
const CONFIG_KEY = 'pwduo:config'
const EMAIL_KEY = 'pwduo:email'
const STASH_KEY = 'pwduo:stash'
const DEFAULT_PREFS: Prefs = { autoLockMin: 2, lockOnHide: true, clearClipboard: true }
/** Tolleranza prima di bloccare quando l'app va in background (serve a incollare altrove una password appena copiata). */
const HIDE_GRACE_MS = 20_000

function readJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...(JSON.parse(raw) as object) } as T : fallback } catch { return fallback }
}
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* noop */ } }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface NewEntryInput { title: string; categoryId: string; username: string; password: string; url: string; notes: string; color?: string }

interface Ctx {
  ready: boolean
  meta: Meta
  file: VaultFile | null
  session: Session | null
  locked: boolean
  status: SyncStatus
  statusMessage: string
  user: drive.GoogleUser | null
  config: drive.GoogleConfig
  setConfig: (c: drive.GoogleConfig) => void
  prefs: Prefs
  setPrefs: (p: Partial<Prefs>) => void
  isOwner: boolean
  /** id del membro corrente (chi ha fatto l'accesso) */
  meId: string
  offlineSkipped: boolean
  setOfflineSkipped: (v: boolean) => void
  /** per mostrare un avviso dopo un blocco automatico o un cambio password altrove */
  lockReason: string
  notice: string
  setNotice: (s: string) => void
  /* accesso e case */
  connect: () => Promise<drive.DriveMeta[]>
  reconnect: () => Promise<void>
  createHouse: (a: { houseName: string; ownerName: string; familyPassword: string; personalSecret: string }) => Promise<void>
  createLocal: (a: { houseName: string; ownerName: string; familyPassword: string; personalSecret: string }) => Promise<void>
  upgradeToDrive: () => Promise<void>
  joinHouse: (idOrLink: string, usePicker: boolean) => Promise<void>
  disconnect: () => Promise<void>
  /* sblocco */
  unlock: (familyPassword: string, personalSecret: string) => Promise<{ setup: boolean }>
  lock: (reason?: string) => Promise<void>
  /* dati */
  addEntry: (scope: Scope, input: NewEntryInput) => void
  updateEntry: (scope: Scope, id: string, input: NewEntryInput, newScope?: Scope) => void
  deleteEntry: (scope: Scope, id: string) => void
  importEntries: (items: NewEntryInput[], scope: Scope) => number
  saveCategory: (c: { id?: string; name: string; icon: string; color: string }) => void
  deleteCategory: (id: string) => void
  /* famiglia */
  shareWith: (email: string, name?: string) => Promise<void>
  removeFamilyMember: (id: string) => Promise<void>
  renameHouse: (name: string) => Promise<void>
  changeFamilyPw: (newPassword: string) => Promise<void>
  changePersonalPw: (newSecret: string) => Promise<void>
  exportBackup: () => string
  syncNow: () => Promise<void>
  resetLocal: () => Promise<void>
}

const C = createContext<Ctx | null>(null)
export function useVault(): Ctx {
  const c = useContext(C)
  if (!c) throw new Error('useVault fuori da VaultProvider')
  return c
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [meta, setMetaState] = useState<Meta>(() => readJson(META_KEY, EMPTY_META))
  const [file, setFileState] = useState<VaultFile | null>(null)
  const [session, setSessionState] = useState<Session | null>(null)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [user, setUser] = useState<drive.GoogleUser | null>(null)
  const [config, setConfigState] = useState<drive.GoogleConfig>(() => ({
    clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
    apiKey: (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? '',
    appId: (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined) ?? '',
    ...readJson<Partial<drive.GoogleConfig>>(CONFIG_KEY, {}),
  }))
  const [prefs, setPrefsState] = useState<Prefs>(() => readJson(PREFS_KEY, DEFAULT_PREFS))
  const [offlineSkipped, setOfflineSkipped] = useState(false)
  const [lockReason, setLockReason] = useState('')
  const [notice, setNotice] = useState('')

  // copie "vive" per le funzioni asincrone
  const metaRef = useRef(meta); const fileRef = useRef<VaultFile | null>(null); const sessionRef = useRef<Session | null>(null)
  const configRef = useRef(config); const prefsRef = useRef(prefs); const userRef = useRef<drive.GoogleUser | null>(null)
  configRef.current = config; prefsRef.current = prefs; userRef.current = user

  const setMeta = useCallback((patch: Partial<Meta> | Meta) => {
    metaRef.current = { ...metaRef.current, ...patch }
    setMetaState(metaRef.current); writeJson(META_KEY, metaRef.current)
  }, [])
  const setFile = useCallback((f: VaultFile | null) => { fileRef.current = f; setFileState(f) }, [])
  const setSession = useCallback((s: Session | null) => { sessionRef.current = s; setSessionState(s) }, [])

  /* ---------- cache locale (solo testo cifrato) ---------- */
  const persistTimer = useRef<number | undefined>(undefined)
  const persist = useCallback(() => {
    window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => { void saveCache(fileRef.current) }, 250)
  }, [])
  useEffect(() => {
    const flush = () => { window.clearTimeout(persistTimer.current); void saveCache(fileRef.current) }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  /* ---------- coda di cifratura: ogni modifica ricifra subito, in ordine ---------- */
  const queue = useRef<Promise<void>>(Promise.resolve())
  const syncTimer = useRef<number | undefined>(undefined)
  const runSyncRef = useRef<() => Promise<void>>(async () => undefined)

  const scheduleSync = useCallback(() => {
    if (metaRef.current.mode !== 'drive') return
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => void runSyncRef.current(), 2000)
  }, [])

  const enqueueSeal = useCallback((parts: { common?: boolean; personal?: boolean }) => {
    setMeta({ dirty: true })
    queue.current = queue.current.then(async () => {
      const s = sessionRef.current; const f = fileRef.current
      if (!s || !f) return
      try {
        setFile(await sealFile(f, s, parts))
        persist(); scheduleSync()
      } catch (e) { setStatus('error'); setStatusMessage(errMsg(e)) }
    })
  }, [persist, scheduleSync, setFile, setMeta])

  /** Aggiorna il file senza toccare la sessione (elenco membri, nome casa…). */
  const enqueueFile = useCallback((fn: (f: VaultFile) => VaultFile) => {
    setMeta({ dirty: true })
    queue.current = queue.current.then(() => {
      const f = fileRef.current
      if (!f) return
      setFile(fn(f)); persist(); scheduleSync()
    })
    return queue.current
  }, [persist, scheduleSync, setFile, setMeta])

  /* ---------- blocco ---------- */
  const lock = useCallback(async (reason = '') => {
    await queue.current // prima che le modifiche in corso siano ricifrate: niente si perde
    setSession(null)
    setLockReason(reason)
    void saveCache(fileRef.current)
  }, [setSession])

  /* ---------- avvio: carica la copia cifrata ---------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      const cached = await loadCache()
      if (!alive) return
      if (cached) { fileRef.current = cached; setFileState(cached) }
      else if (metaRef.current.mode === 'local') setMeta({ ...EMPTY_META })
      else if (metaRef.current.mode === 'drive') {
        // copia locale persa: si adotta Drive così com'è; eventuali modifiche non caricate stavano nella copia persa
        setMeta({ dirty: false, version: '' })
      }
      setStatus(metaRef.current.mode === 'local' ? 'local' : 'idle')
      setReady(true)
    })()
    return () => { alive = false }
  }, [setMeta])

  /* ---------- sincronizzazione ---------- */
  const syncing = useRef(false)
  const again = useRef(false)

  const handleSyncError = useCallback((e: unknown) => {
    if (e instanceof drive.AuthError) { setStatus('auth'); setStatusMessage(e.message) }
    else if (e instanceof drive.NetworkError) { setStatus('offline'); setStatusMessage('') }
    else if (e instanceof drive.NotFoundError) { setStatus('error'); setStatusMessage(e.message) }
    else { setStatus('error'); setStatusMessage(errMsg(e)) }
  }, [])

  /** Una password è cambiata altrove: si adotta la copia di Drive, ma le modifiche locali non sincronizzate vengono messe da parte (cifrate) per recuperarle allo sblocco. */
  const adoptAfterMismatch = useCallback(async (e: KeyMismatchError, local: VaultFile | null, dirty: boolean, remote: VaultFile, remoteVersion: string) => {
    if (dirty && local) {
      await saveStash(local)
      try { localStorage.setItem(STASH_KEY, e.which) } catch { /* noop */ }
    }
    setFile(remote); setMeta({ version: remoteVersion, dirty: false }); setSession(null)
    setLockReason(dirty ? `${e.message} Le modifiche non sincronizzate sono state messe da parte e si recuperano dopo lo sblocco.` : e.message)
    persist(); setStatus('idle')
  }, [persist, setFile, setMeta, setSession])

  const runSync = useCallback(async () => {
    if (metaRef.current.mode !== 'drive' || !metaRef.current.fileId) return
    if (syncing.current) { again.current = true; return }
    syncing.current = true
    setStatus('syncing'); setStatusMessage('')
    try {
      await queue.current
      if (!drive.hasValidToken()) await drive.signIn(configRef.current.clientId, false)
      const fileId = metaRef.current.fileId
      let done = false
      for (let attempt = 0; attempt < 5 && !done; attempt++) {
        // Si lavora su una "fotografia" di file e sessione: se uno dei due cambia durante le attese di rete
        // (modifica, blocco, sblocco) non si applica nulla e si riparte. Così una sync lenta non può riaprire
        // una cassaforte appena bloccata né sovrascrivere una modifica appena fatta.
        const local = fileRef.current
        const sessAtStart = sessionRef.current
        const stale = () => fileRef.current !== local || sessionRef.current !== sessAtStart
        const head = await drive.getMeta(fileId)
        setMeta({ ownerEmail: head.ownerEmail, canShare: head.canShare })
        const known = metaRef.current.version
        let remote: VaultFile | null = null
        let remoteVersion = head.version
        // non allineati (cache persa o versione cambiata): si rilegge Drive
        if (!local || head.version !== known) { const r = await drive.readDb(fileId); remote = r.file; remoteVersion = r.meta.version }
        let merged = local
        let sess = sessAtStart
        const dirty = metaRef.current.dirty && !!local
        if (remote) {
          if (!local || !dirty) {
            merged = remote
            if (sess) {
              try { sess = await reopen(remote, sess) } catch (e) {
                if (e instanceof KeyMismatchError) { if (stale()) { again.current = true; continue } await adoptAfterMismatch(e, local, false, remote, remoteVersion); return }
                throw e
              }
            }
          } else if (!sess) {
            // modifiche locali + novità su Drive, ma la cassaforte è bloccata: non si può unire senza chiavi
            setStatus('idle'); setStatusMessage('Ci sono modifiche da unire: sblocca la cassaforte per sincronizzare.')
            return
          } else {
            try {
              const r = await mergeFiles(local!, remote, sess)
              merged = r.file; sess = r.session
            } catch (e) {
              if (e instanceof KeyMismatchError) { if (stale()) { again.current = true; continue } await adoptAfterMismatch(e, local, true, remote, remoteVersion); return }
              throw e
            }
          }
        }
        if (!merged) throw new Error('Cassaforte non disponibile.')
        if (stale()) { again.current = true; continue }
        const needsUpload = remote ? !sameFile(merged, remote) : dirty
        let version = remoteVersion
        if (needsUpload) {
          try { version = (await drive.writeDb(fileId, merged, remoteVersion)).version } catch (e) {
            if (e instanceof drive.ConflictError) continue // qualcuno ha scritto: rileggi, unisci, riprova
            throw e
          }
        }
        if (stale()) { again.current = true; continue } // il file su Drive è già aggiornato: la prossima passata riunisce la modifica nuova
        setFile(merged)
        if (sess && sess !== sessAtStart) setSession(sess)
        setMeta({ version, dirty: false, lastSyncAt: Date.now() })
        persist()
        done = true
      }
      if (!done && !again.current) throw new Error('Troppi conflitti: riprova tra poco.')
      setStatus('idle'); setStatusMessage('')
    } catch (e) {
      handleSyncError(e)
    } finally {
      syncing.current = false
      if (again.current) { again.current = false; window.setTimeout(() => void runSyncRef.current(), 300) }
    }
  }, [adoptAfterMismatch, handleSyncError, persist, setFile, setMeta, setSession])
  runSyncRef.current = runSync

  const syncNow = useCallback(async () => { await runSync() }, [runSync])

  // sync all'apertura, al ritorno in primo piano, quando torna la rete e ogni 2 minuti
  useEffect(() => {
    if (!ready || meta.mode !== 'drive') return
    void runSync()
    const onVis = () => { if (document.visibilityState === 'visible') void runSync() }
    const onOnline = () => void runSync()
    document.addEventListener('visibilitychange', onVis); window.addEventListener('online', onOnline)
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') void runSync() }, 120_000)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); window.clearInterval(iv) }
  }, [ready, meta.mode, runSync])

  // sessione persistente (Worker): rinnovo del token prima della scadenza, senza popup
  useEffect(() => {
    if (meta.mode !== 'drive') return
    const iv = window.setInterval(() => {
      if (hasSession() && drive.tokenRemainingMs() < 10 * 60_000) void drive.renewWithSession().catch((e) => handleSyncError(e))
    }, 60_000)
    return () => window.clearInterval(iv)
  }, [meta.mode, handleSyncError])

  // senza Worker: rinnovo silenzioso del token a ogni tocco (gesto dell'utente), quando restano meno di 15 minuti e l'ultimo tentativo è di oltre 10 minuti fa
  useEffect(() => {
    if (meta.mode !== 'drive') return
    let lastTry = 0
    const onDown = () => {
      if (hasSession() || !configRef.current.clientId || !drive.hasValidToken() || drive.tokenRemainingMs() > 15 * 60_000 || Date.now() - lastTry < 10 * 60_000) return
      lastTry = Date.now()
      void drive.renewSilently(configRef.current.clientId).catch(() => undefined)
    }
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  }, [meta.mode])

  // identità Google (per capire se sono il Capofamiglia)
  useEffect(() => {
    if (!ready || meta.mode !== 'drive' || user) return
    if (!drive.hasValidToken() && !hasSession()) return
    void drive.getUser().then((u) => { setUser(u); try { localStorage.setItem(EMAIL_KEY, u.email) } catch { /* noop */ } }).catch(() => undefined)
  }, [ready, meta.mode, user, status])

  /* ---------- blocco automatico ---------- */
  useEffect(() => {
    if (!session) return
    let last = Date.now()
    let hiddenAt = 0
    const touch = () => { last = Date.now() }
    const evs = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }))
    const tick = window.setInterval(() => {
      if (Date.now() - last > prefsRef.current.autoLockMin * 60_000) void lock('Bloccata per inattività.')
    }, 5000)
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt) {
        if (prefsRef.current.lockOnHide && Date.now() - hiddenAt > HIDE_GRACE_MS) void lock('Bloccata perché l’app era in background.')
        hiddenAt = 0; last = Date.now()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { evs.forEach((e) => window.removeEventListener(e, touch, { capture: true })); window.clearInterval(tick); document.removeEventListener('visibilitychange', onVis) }
  }, [session, lock])

  /* ---------- accesso e case ---------- */
  const setConfig = useCallback((c: drive.GoogleConfig) => { setConfigState(c); writeJson(CONFIG_KEY, c) }, [])
  const setPrefs = useCallback((p: Partial<Prefs>) => { setPrefsState((cur) => { const n = { ...cur, ...p }; writeJson(PREFS_KEY, n); return n }) }, [])

  const reconnect = useCallback(async () => {
    try {
      await drive.signIn(configRef.current.clientId, true)
      setStatus('idle'); setOfflineSkipped(false)
      await runSyncRef.current()
    } catch (e) { handleSyncError(e) }
  }, [handleSyncError])

  const connect = useCallback(async () => {
    await drive.signIn(configRef.current.clientId, true)
    const u = await drive.getUser()
    setUser(u); try { localStorage.setItem(EMAIL_KEY, u.email) } catch { /* noop */ }
    return drive.findDbFiles()
  }, [])

  const create = useCallback(async (a: { houseName: string; ownerName: string; familyPassword: string; personalSecret: string }, toDrive: boolean) => {
    let email = ''
    if (toDrive) {
      if (!drive.hasValidToken()) await drive.signIn(configRef.current.clientId, true)
      const u = userRef.current ?? (await drive.getUser())
      setUser(u); email = u.email
    }
    const name = a.ownerName.trim() || (toDrive ? userRef.current?.name.split(' ')[0] : '') || 'Io'
    const { file: f, session: s } = await createVault(a.houseName, { name, email, color: MEMBER_COLORS[0], avatar: AVATARS[0] }, a.familyPassword, a.personalSecret)
    if (toDrive) {
      const created = await drive.createDb(f)
      setMeta({ mode: 'drive', fileId: created.id, version: created.version, dirty: false, lastSyncAt: Date.now(), memberId: s.memberId, ownerEmail: created.ownerEmail || email, canShare: true })
      setStatus('idle')
    } else {
      setMeta({ mode: 'local', fileId: '', version: '', dirty: false, lastSyncAt: 0, memberId: s.memberId, ownerEmail: '', canShare: false })
      setStatus('local')
    }
    setFile(f); setSession(s); setLockReason('')
    await saveCache(f)
  }, [setFile, setMeta, setSession])

  const createHouse: Ctx['createHouse'] = (a) => create(a, true)
  const createLocal: Ctx['createLocal'] = (a) => create(a, false)

  /** Da cassaforte solo locale a cassaforte su Drive (il file cifrato viene caricato così com'è). */
  const upgradeToDrive = useCallback(async () => {
    const f = fileRef.current
    if (!f || metaRef.current.mode !== 'local') return
    if (!drive.hasValidToken()) await drive.signIn(configRef.current.clientId, true)
    const u = userRef.current ?? (await drive.getUser())
    setUser(u)
    await queue.current
    const mine = f.members.find((m) => m.id === metaRef.current.memberId)
    const withEmail = mine ? upsertMember(f, { ...mine, email: u.email, updatedAt: Date.now() }) : f
    const created = await drive.createDb(withEmail)
    setFile(withEmail)
    setMeta({ mode: 'drive', fileId: created.id, version: created.version, dirty: false, lastSyncAt: Date.now(), ownerEmail: created.ownerEmail || u.email, canShare: true })
    setStatus('idle'); persist()
  }, [persist, setFile, setMeta])

  const joinHouse: Ctx['joinHouse'] = useCallback(async (idOrLink, usePicker) => {
    if (!drive.hasValidToken()) await drive.signIn(configRef.current.clientId, true)
    let id: string | null
    if (usePicker) id = await drive.pickDbFile(configRef.current, idOrLink ? drive.parseFileId(idOrLink) : undefined)
    else id = idOrLink ? drive.parseFileId(idOrLink) : null
    if (!id) return
    const { meta: rm, file: remote } = await drive.readDb(id)
    const u = userRef.current ?? (await drive.getUser())
    setUser(u)
    // l'account Google è associato al membro tramite l'email; chi non c'è ancora viene aggiunto (idempotente: mai duplicati)
    let joined = remote
    let dirty = false
    let me = remote.members.find((m) => !m.deleted && m.email.toLowerCase() === u.email.toLowerCase())
    if (!me) {
      const n = activeMembers(remote).length
      me = makeMember({ name: u.name.split(' ')[0] || u.email.split('@')[0], email: u.email }, n)
      joined = upsertMember(remote, me); dirty = true
    }
    setFile(joined); setSession(null)
    setMeta({ mode: 'drive', fileId: id, version: rm.version, dirty, lastSyncAt: Date.now(), memberId: me.id, ownerEmail: rm.ownerEmail, canShare: rm.canShare })
    setStatus('idle'); setLockReason(''); clearInvite()
    await saveCache(joined)
    if (dirty) window.setTimeout(() => void runSyncRef.current(), 300)
  }, [setFile, setMeta, setSession])

  const disconnect = useCallback(async () => {
    await queue.current
    if (metaRef.current.mode === 'drive') drive.signOut()
    setSession(null); setFile(null); setUser(null)
    setMeta({ ...EMPTY_META })
    setStatus('idle'); setOfflineSkipped(false); setLockReason('')
    await saveCache(null)
  }, [setFile, setMeta, setSession])

  /* ---------- sblocco ---------- */
  const unlock: Ctx['unlock'] = useCallback(async (familyPassword, personalSecret) => {
    const f = fileRef.current
    if (!f) throw new Error('Nessuna cassaforte.')
    const r = await unlockVault(f, metaRef.current.memberId, familyPassword, personalSecret)
    setSession(r.session); setLockReason('')
    if (r.setup) {
      setFile(r.file); setMeta({ dirty: true }); persist(); scheduleSync()
    } else if (metaRef.current.dirty || metaRef.current.mode === 'drive') {
      void runSyncRef.current() // unisce eventuali modifiche rimaste in attesa
    }
    // modifiche messe da parte quando una password è cambiata altrove: si recuperano i blocchi la cui chiave non è cambiata
    const stash = await loadStash()
    if (stash && stash.vaultId === f.vaultId) {
      const rec = await recoverFromStash(stash, r.session)
      let which = ''
      try { which = localStorage.getItem(STASH_KEY) ?? '' } catch { /* noop */ }
      if (rec.common || rec.personal) { setSession(rec.session); enqueueSeal({ common: rec.common, personal: rec.personal }) }
      const lost = which === 'common' ? 'comuni' : which === 'personal' ? 'personali' : ''
      setNotice(rec.common || rec.personal
        ? `Recuperate le modifiche non sincronizzate${lost ? `; quelle ${lost} fatte prima del cambio password non erano recuperabili` : ''}.`
        : lost ? `Le modifiche ${lost} non sincronizzate fatte prima del cambio password non erano recuperabili.` : '')
      await saveStash(null)
      try { localStorage.removeItem(STASH_KEY) } catch { /* noop */ }
    }
    return { setup: r.setup }
  }, [enqueueSeal, persist, scheduleSync, setFile, setMeta, setSession])

  /* ---------- modifiche ai dati ---------- */
  const mine = () => sessionRef.current?.memberId ?? ''
  const ownerNow = () => metaRef.current.mode === 'local' || (!!userRef.current && !!metaRef.current.ownerEmail && userRef.current.email === metaRef.current.ownerEmail)

  const patchSession = useCallback((fn: (s: Session) => Session, parts: { common?: boolean; personal?: boolean }) => {
    const s = sessionRef.current
    if (!s) return
    setSession(fn(s))
    enqueueSeal(parts)
  }, [enqueueSeal, setSession])

  const build = (id: string, i: NewEntryInput, base?: Entry): Entry => {
    const now = Date.now()
    return { id, title: i.title.trim(), categoryId: i.categoryId || GENERAL_CATEGORY_ID, username: i.username.trim(), password: i.password, url: i.url.trim(), notes: i.notes, color: i.color, createdBy: base?.createdBy ?? mine(), createdAt: base?.createdAt ?? now, updatedAt: now }
  }

  const addEntry: Ctx['addEntry'] = (scope, input) => {
    const e = build(uid('e'), input)
    if (scope === 'common') patchSession((s) => ({ ...s, common: { ...s.common, entries: [...s.common.entries, e] } }), { common: true })
    else patchSession((s) => ({ ...s, personal: { entries: [...s.personal.entries, e] } }), { personal: true })
  }

  const updateEntry: Ctx['updateEntry'] = (scope, id, input, newScope = scope) => {
    const s = sessionRef.current
    if (!s) return
    const list = scope === 'common' ? s.common.entries : s.personal.entries
    const old = list.find((x) => x.id === id)
    if (!old) return
    if (scope === 'common' && !canEditCommon(old, s.memberId, ownerNow())) return
    const e = build(id, input, old)
    if (newScope === scope) {
      if (scope === 'common') patchSession((x) => ({ ...x, common: { ...x.common, entries: x.common.entries.map((y) => (y.id === id ? e : y)) } }), { common: true })
      else patchSession((x) => ({ ...x, personal: { entries: x.personal.entries.map((y) => (y.id === id ? e : y)) } }), { personal: true })
    } else if (newScope === 'personal') { // comune → personale: diventa mia, sparisce dalla vista della famiglia
      patchSession((x) => ({
        ...x,
        common: { ...x.common, entries: x.common.entries.map((y) => (y.id === id ? tombstoneEntry(old) : y)) },
        personal: { entries: [...x.personal.entries, { ...e, createdBy: x.memberId }] },
      }), { common: true, personal: true })
    } else { // personale → comune
      patchSession((x) => ({
        ...x,
        personal: { entries: x.personal.entries.map((y) => (y.id === id ? tombstoneEntry(old) : y)) },
        common: { ...x.common, entries: [...x.common.entries, { ...e, createdBy: x.memberId }] },
      }), { common: true, personal: true })
    }
  }

  const deleteEntry: Ctx['deleteEntry'] = (scope, id) => {
    const s = sessionRef.current
    if (!s) return
    const old = (scope === 'common' ? s.common.entries : s.personal.entries).find((x) => x.id === id)
    if (!old) return
    if (scope === 'common' && !canEditCommon(old, s.memberId, ownerNow())) return
    if (scope === 'common') patchSession((x) => ({ ...x, common: { ...x.common, entries: x.common.entries.map((y) => (y.id === id ? tombstoneEntry(old) : y)) } }), { common: true })
    else patchSession((x) => ({ ...x, personal: { entries: x.personal.entries.map((y) => (y.id === id ? tombstoneEntry(old) : y)) } }), { personal: true })
  }

  const importEntries: Ctx['importEntries'] = (items, scope) => {
    const s = sessionRef.current
    if (!s || !items.length) return 0
    // un membro non può creare categorie: i gruppi sconosciuti finiscono in «Generale»
    const known = new Set(s.common.categories.filter((c) => !c.deleted).map((c) => c.id))
    const made = items.map((i) => build(uid('e'), { ...i, categoryId: known.has(i.categoryId) ? i.categoryId : GENERAL_CATEGORY_ID }))
    if (scope === 'common') patchSession((x) => ({ ...x, common: { ...x.common, entries: [...x.common.entries, ...made] } }), { common: true })
    else patchSession((x) => ({ ...x, personal: { entries: [...x.personal.entries, ...made] } }), { personal: true })
    return made.length
  }

  const saveCategory: Ctx['saveCategory'] = (c) => {
    if (!ownerNow()) return // solo il Capofamiglia
    const now = Date.now()
    patchSession((s) => {
      const cat: Category = { id: c.id ?? uid('c'), name: c.name.trim(), icon: c.icon, color: c.color, updatedAt: now }
      const has = s.common.categories.some((x) => x.id === cat.id)
      return { ...s, common: { ...s.common, categories: has ? s.common.categories.map((x) => (x.id === cat.id ? cat : x)) : [...s.common.categories, cat] } }
    }, { common: true })
  }

  const deleteCategory: Ctx['deleteCategory'] = (id) => {
    if (!ownerNow() || id === GENERAL_CATEGORY_ID) return
    const now = Date.now()
    patchSession((s) => ({
      ...s,
      common: {
        categories: s.common.categories.map((x) => (x.id === id ? tombstoneCategory(x, now) : x)),
        // le voci comuni di questa categoria passano a «Generale» (le personali degli altri ricadono su «Generale» in visualizzazione)
        entries: s.common.entries.map((e) => (e.categoryId === id && !e.deleted ? { ...e, categoryId: GENERAL_CATEGORY_ID, updatedAt: now } : e)),
      },
      personal: { entries: s.personal.entries.map((e) => (e.categoryId === id && !e.deleted ? { ...e, categoryId: GENERAL_CATEGORY_ID, updatedAt: now } : e)) },
    }), { common: true, personal: true })
  }

  /* ---------- famiglia ---------- */
  const shareWith: Ctx['shareWith'] = async (email, name) => {
    const id = metaRef.current.fileId
    const f = fileRef.current
    if (!id || !f) throw new Error('Collega prima la cassaforte a Google Drive.')
    if (!ownerNow()) throw new Error('Solo il Capofamiglia può invitare.')
    if (!drive.hasValidToken()) await drive.signIn(configRef.current.clientId, true)
    const addr = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new Error('Indirizzo email non valido.')
    await drive.shareFile(id, addr, `Ti invito nella cassaforte di famiglia «${f.houseName}» su Password Duo. Apri questo link e accedi con questo account Google: ${inviteLink(id)} — poi ti serviranno la Password di Famiglia (te la dà chi ti ha invitato di persona) e una tua password personale.`)
    if (!f.members.some((m) => !m.deleted && m.email === addr)) {
      const n = activeMembers(f).length
      await enqueueFile((x) => upsertMember(x, makeMember({ name: name?.trim() || addr.split('@')[0], email: addr }, n)))
    }
    void runSyncRef.current()
  }

  const removeFamilyMember: Ctx['removeFamilyMember'] = async (id) => {
    const f = fileRef.current
    const m = f?.members.find((x) => x.id === id)
    if (!f || !m || !ownerNow()) return
    if (m.email.toLowerCase() === metaRef.current.ownerEmail) throw new Error('Il Capofamiglia non si può rimuovere.')
    if (metaRef.current.mode === 'drive' && m.email) {
      if (!drive.hasValidToken()) await drive.signIn(configRef.current.clientId, true)
      await drive.removeShare(metaRef.current.fileId, m.email)
    }
    await enqueueFile((x) => removeMember(x, id))
    void runSyncRef.current()
  }

  const renameHouse: Ctx['renameHouse'] = async (name) => { await enqueueFile((f) => ({ ...f, houseName: name.trim() || f.houseName, lastUpdated: Date.now() })) }

  const changeFamilyPw: Ctx['changeFamilyPw'] = async (newPassword) => {
    const s = sessionRef.current; const f = fileRef.current
    if (!s || !f) return
    await queue.current
    const r = await changeFamilyPassword(fileRef.current!, sessionRef.current!, newPassword)
    setSession(r.session); setFile(r.file); setMeta({ dirty: true }); persist()
    await runSyncRef.current()
  }
  const changePersonalPw: Ctx['changePersonalPw'] = async (newSecret) => {
    const s = sessionRef.current; const f = fileRef.current
    if (!s || !f) return
    await queue.current
    const r = await changePersonalSecret(fileRef.current!, sessionRef.current!, newSecret)
    setSession(r.session); setFile(r.file); setMeta({ dirty: true }); persist()
    await runSyncRef.current()
  }

  const exportBackup = useCallback(() => JSON.stringify(parseVault(fileRef.current), null, 2), [])

  const resetLocal = useCallback(async () => { await disconnect() }, [disconnect])

  const isOwner = meta.mode === 'local' || (!!user && !!meta.ownerEmail && user.email === meta.ownerEmail)

  const value = useMemo<Ctx>(() => ({
    ready, meta, file, session, locked: !!file && !session, status, statusMessage, user, config, setConfig, prefs, setPrefs, isOwner,
    meId: meta.memberId, offlineSkipped, setOfflineSkipped, lockReason, notice, setNotice,
    connect, reconnect, createHouse, createLocal, upgradeToDrive, joinHouse, disconnect, unlock, lock,
    addEntry, updateEntry, deleteEntry, importEntries, saveCategory, deleteCategory,
    shareWith, removeFamilyMember, renameHouse, changeFamilyPw, changePersonalPw, exportBackup, syncNow, resetLocal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, meta, file, session, status, statusMessage, user, config, prefs, isOwner, offlineSkipped, lockReason, notice])

  return <C.Provider value={value}>{children}</C.Provider>
}

export { MEMBER_COLORS }
