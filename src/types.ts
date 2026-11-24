/** Tipi del dominio. Tutto ciò che è segreto vive dentro un blocco cifrato (vedi cryptoService / vaultModel). */

/** Parametri di derivazione della chiave, salvati dentro ogni blocco (così si possono aggiornare in futuro). */
export interface Kdf { alg: 'PBKDF2-SHA256'; iter: number; salt: string }

/** Blocco cifrato AES-GCM-256. `rev` cresce a ogni scrittura e serve a scegliere tra due copie che non si possono decifrare. */
export interface Block { rev: number; updatedAt: number; kdf: Kdf; iv: string; ct: string }

/** Elenco dei membri: in chiaro, perché l'identità (email) va risolta prima dello sblocco. Non contiene segreti. */
export interface MemberRec {
  id: string
  name: string
  email: string
  color: string
  avatar: string
  updatedAt: number
  deleted?: boolean
  /** Blocco personale del membro: lo apre solo chi conosce la sua password personale. Assente finché non la imposta. */
  personal?: Block | null
}

/** File sincronizzato su Drive (`family-vault-db.enc.json`). */
export interface VaultFile {
  schema: 'family-vault'
  version: 1
  vaultId: string
  houseName: string
  lastUpdated: number
  common: Block
  members: MemberRec[]
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  updatedAt: number
  deleted?: boolean
}

export interface Entry {
  id: string
  title: string
  categoryId: string
  username: string
  password: string
  url: string
  notes: string
  color?: string
  /** id del membro che l'ha creata (solo le voci comuni: chi le ha create, o il Capofamiglia, può modificarle) */
  createdBy: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export interface CommonData { categories: Category[]; entries: Entry[] }
export interface PersonalData { entries: Entry[] }

export type Scope = 'common' | 'personal'
export type TabId = 'vault' | 'generator' | 'categories' | 'family'

export const GENERAL_CATEGORY_ID = 'general'

export interface Prefs {
  /** minuti di inattività prima del blocco automatico */
  autoLockMin: number
  /** blocca quando l'app va in background (dopo una breve tolleranza) */
  lockOnHide: boolean
  /** svuota gli appunti 30 secondi dopo una copia */
  clearClipboard: boolean
}
