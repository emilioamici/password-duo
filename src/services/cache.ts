/**
 * Copia locale della cassaforte: SOLO il file cifrato (lo stesso che sta su Drive), mai testo in chiaro.
 * IndexedDB con ripiego su localStorage.
 */
import type { VaultFile } from '../types'

const DB = 'pwduo'
const STORE = 'kv'
const KEY = 'vault'
const STASH = 'stash'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function loadCache(): Promise<VaultFile | null> {
  try {
    const db = await open()
    const v = await new Promise<unknown>((resolve, reject) => {
      const rq = db.transaction(STORE).objectStore(STORE).get(KEY)
      rq.onsuccess = () => resolve(rq.result); rq.onerror = () => reject(rq.error)
    })
    db.close()
    if (v) return v as VaultFile
  } catch { /* ripiego */ }
  try { const raw = localStorage.getItem('pwduo:vault'); return raw ? (JSON.parse(raw) as VaultFile) : null } catch { return null }
}

/** true se salvato. */
export async function saveCache(file: VaultFile | null): Promise<boolean> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      if (file) tx.objectStore(STORE).put(file, KEY); else tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
    try { localStorage.removeItem('pwduo:vault') } catch { /* noop */ }
    return true
  } catch {
    try { if (file) localStorage.setItem('pwduo:vault', JSON.stringify(file)); else localStorage.removeItem('pwduo:vault'); return true } catch { return false }
  }
}

/** Copia locale messa da parte (sempre cifrata) quando una password è cambiata altrove e c'erano modifiche non sincronizzate. */
export async function saveStash(file: VaultFile | null): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      if (file) tx.objectStore(STORE).put(file, STASH); else tx.objectStore(STORE).delete(STASH)
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* nessun ripiego: è un salvataggio di emergenza */ }
}

export async function loadStash(): Promise<VaultFile | null> {
  try {
    const db = await open()
    const v = await new Promise<unknown>((resolve, reject) => {
      const rq = db.transaction(STORE).objectStore(STORE).get(STASH)
      rq.onsuccess = () => resolve(rq.result); rq.onerror = () => reject(rq.error)
    })
    db.close()
    return (v as VaultFile) ?? null
  } catch { return null }
}
