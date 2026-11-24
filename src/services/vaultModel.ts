/**
 * Modello della cassaforte: creazione, sblocco, cifratura a blocchi e unione (merge) tra copie.
 *
 * Struttura del file (`family-vault-db.enc.json`):
 * - `common`: blocco cifrato con la Password di Famiglia → categorie + voci comuni;
 * - `members[]`: elenco in chiaro (id, nome, email…) e, per ciascun membro, il suo blocco personale
 *   cifrato con una chiave derivata dalla SUA password personale (indipendente da quella di famiglia).
 *
 * Regola d'oro del merge: un dispositivo decifra solo il blocco comune e il proprio blocco personale.
 * I blocchi personali degli altri vengono copiati byte per byte, mai ricostruiti.
 */
import {
  DecryptError, decryptJson, deriveKey, encryptJson, newKdf, uid,
} from './cryptoService'
import {
  GENERAL_CATEGORY_ID, type Block, type Category, type CommonData, type Entry, type Kdf, type MemberRec,
  type PersonalData, type VaultFile,
} from '../types'

export const VAULT_SCHEMA = 'family-vault'
export const MEMBER_COLORS = ['#c9692a', '#e0a93e', '#5b6577', '#2a8f78', '#c0506a', '#3f87b8']
export const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🐝', '🦄']

/** Password di famiglia o personale sbagliata. `which` dice quale. */
export class UnlockError extends Error {
  constructor(public which: 'common' | 'personal') {
    super(which === 'common' ? 'Password di Famiglia errata.' : 'Password personale errata.')
    this.name = 'UnlockError'
  }
}
/** Il blocco è stato cifrato con un'altra chiave (password cambiata altrove): serve reinserire la password. */
export class KeyMismatchError extends Error {
  constructor(public which: 'common' | 'personal') {
    super(which === 'common' ? 'La Password di Famiglia è stata cambiata: inserisci quella nuova.' : 'La password personale è stata cambiata: inseriscila di nuovo.')
    this.name = 'KeyMismatchError'
  }
}

export interface HeldKey { key: CryptoKey; kdf: Kdf }

/** Stato sbloccato: chiavi e dati in chiaro. Esiste solo in memoria e viene buttato al blocco. */
export interface Session {
  memberId: string
  commonKey: HeldKey
  personalKey: HeldKey
  common: CommonData
  personal: PersonalData
}

const aadCommon = (vaultId: string) => `fv1|common|${vaultId}`
const aadPersonal = (vaultId: string, memberId: string) => `fv1|personal|${vaultId}|${memberId}`

/* ---------- utilità ---------- */
/** JSON canonico (chiavi ordinate) per confrontare il contenuto. */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

interface Rec { id: string; updatedAt: number; deleted?: boolean }
/** Unione per record: vince l'`updatedAt` più recente; a parità, scelta deterministica. Le cancellazioni sono tombstone. */
export function mergeRecords<T extends Rec>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>()
  for (const r of [...a, ...b]) {
    const cur = map.get(r.id)
    if (!cur || r.updatedAt > cur.updatedAt || (r.updatedAt === cur.updatedAt && canon(r) > canon(cur))) map.set(r.id, r)
  }
  return [...map.values()].sort((x, y) => (x.id < y.id ? -1 : 1))
}

export const mergeCommon = (a: CommonData, b: CommonData): CommonData => ({
  categories: mergeRecords(a.categories, b.categories),
  entries: mergeRecords(a.entries, b.entries),
})
export const mergePersonal = (a: PersonalData, b: PersonalData): PersonalData => ({ entries: mergeRecords(a.entries, b.entries) })

export function defaultCategories(now = Date.now()): Category[] {
  const c = (id: string, name: string, icon: string, color: string): Category => ({ id, name, icon, color, updatedAt: now })
  return [
    c(GENERAL_CATEGORY_ID, 'Generale', 'Folder', '#5b6577'),
    c('streaming', 'Streaming & Abbonamenti', 'Tv', '#8a5fa8'),
    c('utilities', 'Utenze & Casa', 'Home', '#e0a93e'),
    c('finance', 'Finanza & Banche', 'Landmark', '#2a8f78'),
    c('social', 'Social & Email', 'AtSign', '#3f87b8'),
    c('wifi', 'Wi-Fi & Dispositivi', 'Wifi', '#c9692a'),
  ]
}

export function tombstoneEntry(e: Entry, now = Date.now()): Entry {
  return { id: e.id, title: '', categoryId: GENERAL_CATEGORY_ID, username: '', password: '', url: '', notes: '', createdBy: e.createdBy, createdAt: e.createdAt, updatedAt: now, deleted: true }
}
export function tombstoneCategory(c: Category, now = Date.now()): Category {
  return { id: c.id, name: '', icon: 'Folder', color: '#5b6577', updatedAt: now, deleted: true }
}

/** Solo chi ha creato una voce comune (o il Capofamiglia) può modificarla o eliminarla. */
export const canEditCommon = (e: Entry, memberId: string, isOwner: boolean): boolean => isOwner || e.createdBy === memberId

/* ---------- blocchi ---------- */
async function sealBlock(held: HeldKey, data: unknown, aad: string, rev: number): Promise<Block> {
  const { iv, ct } = await encryptJson(held.key, data, aad)
  return { rev, updatedAt: Date.now(), kdf: held.kdf, iv, ct }
}

async function openBlock<T>(block: Block, held: HeldKey, aad: string, which: 'common' | 'personal'): Promise<T> {
  if (block.kdf.salt !== held.kdf.salt || block.kdf.iter !== held.kdf.iter) throw new KeyMismatchError(which)
  try { return await decryptJson<T>(held.key, block, aad) } catch (e) {
    if (e instanceof DecryptError) throw new KeyMismatchError(which)
    throw e
  }
}

const sameBlock = (a: Block, b: Block) => a.iv === b.iv && a.ct === b.ct
/** Tra due blocchi che non si possono leggere: vince il `rev` più alto, poi il più recente, poi un confronto deterministico. */
function pickBlock(a: Block, b: Block): Block {
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  return a.iv >= b.iv ? a : b
}

async function mergeReadable<T>(a: Block, b: Block, held: HeldKey, aad: string, which: 'common' | 'personal', merge: (x: T, y: T) => T): Promise<{ block: Block; data: T }> {
  if (sameBlock(a, b)) return { block: a, data: await openBlock<T>(a, held, aad, which) }
  const [da, db] = await Promise.all([openBlock<T>(a, held, aad, which), openBlock<T>(b, held, aad, which)])
  const merged = merge(da, db)
  const winner = pickBlock(a, b)
  const winnerData = winner === a ? da : db
  if (canon(merged) === canon(winnerData)) return { block: winner, data: merged } // niente da riscrivere
  return { block: await sealBlock(held, merged, aad, Math.max(a.rev, b.rev) + 1), data: merged }
}

/* ---------- creazione ---------- */
export interface NewMember { id?: string; name: string; email: string; color?: string; avatar?: string }

export function makeMember(m: NewMember, index = 0): MemberRec {
  return {
    id: m.id ?? uid('m'), name: m.name.trim() || m.email.split('@')[0], email: m.email.trim().toLowerCase(),
    color: m.color ?? MEMBER_COLORS[index % MEMBER_COLORS.length], avatar: m.avatar ?? AVATARS[index % AVATARS.length],
    updatedAt: Date.now(), personal: null,
  }
}

export async function createVault(houseName: string, owner: NewMember, familyPassword: string, personalSecret: string): Promise<{ file: VaultFile; session: Session }> {
  const vaultId = uid('v')
  const member = makeMember(owner)
  const ckdf = newKdf(); const pkdf = newKdf()
  const [ckey, pkey] = await Promise.all([deriveKey(familyPassword, ckdf), deriveKey(personalSecret, pkdf)])
  const commonKey: HeldKey = { key: ckey, kdf: ckdf }
  const personalKey: HeldKey = { key: pkey, kdf: pkdf }
  const common: CommonData = { categories: defaultCategories(), entries: [] }
  const personal: PersonalData = { entries: [] }
  member.personal = await sealBlock(personalKey, personal, aadPersonal(vaultId, member.id), 1)
  const file: VaultFile = {
    schema: VAULT_SCHEMA, version: 1, vaultId, houseName: houseName.trim() || 'La nostra famiglia', lastUpdated: Date.now(),
    common: await sealBlock(commonKey, common, aadCommon(vaultId), 1),
    members: [member],
  }
  return { file, session: { memberId: member.id, commonKey, personalKey, common, personal } }
}

export function parseVault(json: unknown): VaultFile {
  const f = json as Partial<VaultFile> | null
  if (!f || f.schema !== VAULT_SCHEMA || f.version !== 1 || typeof f.vaultId !== 'string' || !f.common || !Array.isArray(f.members)) {
    throw new Error('File non valido: non è una cassaforte Password Duo.')
  }
  return f as VaultFile
}

/* ---------- sblocco ---------- */
export interface UnlockResult { file: VaultFile; session: Session; /** true se è stata creata ora la password personale del membro */ setup: boolean }

/**
 * Sblocca con la Password di Famiglia e la password personale.
 * Se il membro non ha ancora un blocco personale (primo accesso dopo l'invito), lo crea con la password data.
 */
export async function unlockVault(file: VaultFile, memberId: string, familyPassword: string, personalSecret: string): Promise<UnlockResult> {
  const rec = file.members.find((m) => m.id === memberId && !m.deleted)
  if (!rec) throw new Error('Membro non trovato nella cassaforte.')
  const pkdf = rec.personal ? rec.personal.kdf : newKdf()
  const [ckey, pkey] = await Promise.all([deriveKey(familyPassword, file.common.kdf), deriveKey(personalSecret, pkdf)])
  const commonKey: HeldKey = { key: ckey, kdf: file.common.kdf }
  const personalKey: HeldKey = { key: pkey, kdf: pkdf }
  let common: CommonData
  try { common = await decryptJson<CommonData>(ckey, file.common, aadCommon(file.vaultId)) } catch { throw new UnlockError('common') }
  if (rec.personal) {
    let personal: PersonalData
    try { personal = await decryptJson<PersonalData>(pkey, rec.personal, aadPersonal(file.vaultId, rec.id)) } catch { throw new UnlockError('personal') }
    return { file, session: { memberId, commonKey, personalKey, common, personal }, setup: false }
  }
  const personal: PersonalData = { entries: [] }
  const block = await sealBlock(personalKey, personal, aadPersonal(file.vaultId, rec.id), 1)
  const next = { ...file, lastUpdated: Date.now(), members: file.members.map((m) => (m.id === rec.id ? { ...m, personal: block, updatedAt: Date.now() } : m)) }
  return { file: next, session: { memberId, commonKey, personalKey, common, personal }, setup: true }
}

/** Ricostruisce i dati in chiaro da un file usando le chiavi già in memoria (dopo aver adottato la copia di Drive). */
export async function reopen(file: VaultFile, held: Pick<Session, 'memberId' | 'commonKey' | 'personalKey'>): Promise<Session> {
  const rec = file.members.find((m) => m.id === held.memberId && !m.deleted)
  if (!rec) throw new Error('Non fai più parte di questa cassaforte.')
  if (!rec.personal) throw new KeyMismatchError('personal')
  const [common, personal] = await Promise.all([
    openBlock<CommonData>(file.common, held.commonKey, aadCommon(file.vaultId), 'common'),
    openBlock<PersonalData>(rec.personal, held.personalKey, aadPersonal(file.vaultId, rec.id), 'personal'),
  ])
  return { ...held, common, personal }
}

/* ---------- scrittura ---------- */
/** Ricifra il blocco comune e/o il proprio blocco personale con i dati correnti della sessione. */
export async function sealFile(file: VaultFile, s: Session, parts: { common?: boolean; personal?: boolean }): Promise<VaultFile> {
  const now = Date.now()
  let common = file.common
  if (parts.common) common = await sealBlock(s.commonKey, s.common, aadCommon(file.vaultId), file.common.rev + 1)
  let members = file.members
  if (parts.personal) {
    const mine = file.members.find((m) => m.id === s.memberId)
    const block = await sealBlock(s.personalKey, s.personal, aadPersonal(file.vaultId, s.memberId), (mine?.personal?.rev ?? 0) + 1)
    members = file.members.map((m) => (m.id === s.memberId ? { ...m, personal: block, updatedAt: now } : m))
  }
  return { ...file, common, members, lastUpdated: now }
}

/** Cambia la Password di Famiglia: nuovo salt, nuova chiave, blocco comune ricifrato. */
export async function changeFamilyPassword(file: VaultFile, s: Session, newPassword: string): Promise<{ file: VaultFile; session: Session }> {
  const kdf = newKdf()
  const session: Session = { ...s, commonKey: { key: await deriveKey(newPassword, kdf), kdf } }
  return { file: await sealFile(file, session, { common: true }), session }
}

/** Cambia la password personale del membro: nuovo salt, nuova chiave, blocco personale ricifrato. */
export async function changePersonalSecret(file: VaultFile, s: Session, newSecret: string): Promise<{ file: VaultFile; session: Session }> {
  const kdf = newKdf()
  const session: Session = { ...s, personalKey: { key: await deriveKey(newSecret, kdf), kdf } }
  return { file: await sealFile(file, session, { personal: true }), session }
}

/** Verifica una password personale senza modificare nulla (per conferme sensibili). */
export async function verifyPersonalSecret(file: VaultFile, memberId: string, secret: string): Promise<boolean> {
  const rec = file.members.find((m) => m.id === memberId)
  if (!rec?.personal) return false
  try { await decryptJson(await deriveKey(secret, rec.personal.kdf), rec.personal, aadPersonal(file.vaultId, memberId)); return true } catch { return false }
}

/* ---------- elenco membri ---------- */
export const activeMembers = (f: VaultFile): MemberRec[] => f.members.filter((m) => !m.deleted)

export function upsertMember(file: VaultFile, m: MemberRec): VaultFile {
  const exists = file.members.some((x) => x.id === m.id)
  return { ...file, lastUpdated: Date.now(), members: exists ? file.members.map((x) => (x.id === m.id ? m : x)) : [...file.members, m] }
}

/** Rimuove il membro dall'elenco (tombstone) e butta il suo blocco personale. */
export function removeMember(file: VaultFile, id: string): VaultFile {
  const now = Date.now()
  return { ...file, lastUpdated: now, members: file.members.map((m) => (m.id === id ? { ...m, deleted: true, personal: null, updatedAt: now } : m)) }
}

/* ---------- merge tra due copie del file ---------- */
function mergeMemberRec(a: MemberRec, b: MemberRec): MemberRec {
  // a parità di istante la rimozione vince (un membro rimosso non deve risorgere)
  const newer = a.updatedAt !== b.updatedAt ? (a.updatedAt > b.updatedAt ? a : b)
    : !!a.deleted !== !!b.deleted ? (a.deleted ? a : b)
    : canon({ ...a, personal: null }) >= canon({ ...b, personal: null }) ? a : b
  if (newer.deleted) return { ...newer, personal: null }
  // il blocco personale viaggia per conto suo: vince il più recente (rev), mai ricostruito
  const personal = a.personal && b.personal ? pickBlock(a.personal, b.personal) : (a.personal ?? b.personal ?? null)
  return { ...newer, personal }
}

/**
 * Unisce due copie del file. Con una sessione sbloccata unisce anche il contenuto del blocco comune e del
 * proprio blocco personale; senza, sceglie blocco per blocco la copia più recente (solo se non si deve fondere).
 */
export async function mergeFiles(local: VaultFile, remote: VaultFile, session: Session | null): Promise<{ file: VaultFile; session: Session | null }> {
  if (local.vaultId !== remote.vaultId) throw new Error('Il file su Drive è un\'altra cassaforte.')
  const byId = new Map<string, MemberRec>()
  for (const m of [...local.members, ...remote.members]) {
    const cur = byId.get(m.id)
    byId.set(m.id, cur ? mergeMemberRec(cur, m) : m)
  }
  const members = [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : 1))
  const newer = local.lastUpdated >= remote.lastUpdated ? local : remote
  let common = pickBlock(local.common, remote.common)
  let next: Session | null = session
  if (session) {
    const c = await mergeReadable<CommonData>(local.common, remote.common, session.commonKey, aadCommon(local.vaultId), 'common', mergeCommon)
    common = c.block
    const mineL = local.members.find((m) => m.id === session.memberId)?.personal
    const mineR = remote.members.find((m) => m.id === session.memberId)?.personal
    let personalData = session.personal
    if (mineL && mineR) {
      const p = await mergeReadable<PersonalData>(mineL, mineR, session.personalKey, aadPersonal(local.vaultId, session.memberId), 'personal', mergePersonal)
      personalData = p.data
      const i = members.findIndex((m) => m.id === session.memberId)
      if (i >= 0) members[i] = { ...members[i], personal: p.block }
    }
    next = { ...session, common: c.data, personal: personalData }
  }
  return { file: { ...newer, houseName: newer.houseName, common, members, lastUpdated: Math.max(local.lastUpdated, remote.lastUpdated) }, session: next }
}

/**
 * Recupera le modifiche non sincronizzate di una copia locale messa da parte (perché una password è cambiata altrove).
 * Ogni blocco si prova per conto suo con le chiavi di ORA: quello la cui chiave non è cambiata si apre e viene unito;
 * l'altro, cifrato con la chiave vecchia, non è recuperabile.
 */
export async function recoverFromStash(stash: VaultFile, s: Session): Promise<{ session: Session; common: boolean; personal: boolean }> {
  let next = s; let common = false; let personal = false
  try {
    const d = await openBlock<CommonData>(stash.common, s.commonKey, aadCommon(stash.vaultId), 'common')
    const m = mergeCommon(s.common, d)
    if (canon(m) !== canon(s.common)) { next = { ...next, common: m }; common = true }
  } catch { /* chiave vecchia: non recuperabile */ }
  const mine = stash.members.find((m) => m.id === s.memberId)?.personal
  if (mine) {
    try {
      const d = await openBlock<PersonalData>(mine, s.personalKey, aadPersonal(stash.vaultId, s.memberId), 'personal')
      const m = mergePersonal(next.personal, d)
      if (canon(m) !== canon(next.personal)) { next = { ...next, personal: m }; personal = true }
    } catch { /* idem */ }
  }
  return { session: next, common, personal }
}

/** Le due copie hanno lo stesso contenuto? (per sapere se serve caricare) */
export const sameFile = (a: VaultFile, b: VaultFile): boolean =>
  a.houseName === b.houseName && sameBlock(a.common, b.common) && a.members.length === b.members.length &&
  canon(a.members.map((m) => ({ ...m, personal: m.personal ? { iv: m.personal.iv, ct: m.personal.ct } : null })).sort((x, y) => (x.id < y.id ? -1 : 1))) ===
  canon(b.members.map((m) => ({ ...m, personal: m.personal ? { iv: m.personal.iv, ct: m.personal.ct } : null })).sort((x, y) => (x.id < y.id ? -1 : 1)))
