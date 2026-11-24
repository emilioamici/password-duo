import { beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_GEN, MAX_ITER, b64, decryptJson, deriveKey, encryptJson, estimateStrength, generatePassword, newKdf,
  randomInt, secureShuffle, setDefaultIterForTests, unb64,
} from './cryptoService'
import {
  KeyMismatchError, UnlockError, canEditCommon, changeFamilyPassword, changePersonalSecret, createVault, makeMember, mergeFiles,
  mergeRecords, removeMember, reopen, sealFile, tombstoneEntry, unlockVault, upsertMember, verifyPersonalSecret, type Session,
} from './vaultModel'
import type { Entry } from '../types'

beforeAll(() => setDefaultIterForTests(100_000))

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id, title: 'Netflix', categoryId: 'streaming', username: 'u', password: 'p4ss', url: '', notes: '', createdBy: 'm', createdAt: 1, updatedAt: 1, ...over,
})
const FAM = 'password-di-famiglia'
const ANNA = 'segreto-personale-anna'
const BRUNO = 'segreto-personale-bruno'

describe('cryptoService', () => {
  it('cifra e decifra con AAD corretto, fallisce con AAD diverso o chiave sbagliata', async () => {
    const kdf = newKdf()
    const key = await deriveKey('pw', kdf)
    const box = await encryptJson(key, { a: 1 }, 'ctx-1')
    expect(await decryptJson(key, box, 'ctx-1')).toEqual({ a: 1 })
    await expect(decryptJson(key, box, 'ctx-2')).rejects.toThrow()
    await expect(decryptJson(await deriveKey('altra', kdf), box, 'ctx-1')).rejects.toThrow()
  })

  it('usa un IV nuovo a ogni cifratura', async () => {
    const key = await deriveKey('pw', newKdf())
    const ivs = new Set<string>()
    for (let i = 0; i < 50; i++) ivs.add((await encryptJson(key, 'x', 'a')).iv)
    expect(ivs.size).toBe(50)
  })

  it('rifiuta parametri KDF fuori intervallo', async () => {
    await expect(deriveKey('pw', { alg: 'PBKDF2-SHA256', iter: 1, salt: b64(new Uint8Array(16)) })).rejects.toThrow()
    await expect(deriveKey('pw', { alg: 'PBKDF2-SHA256', iter: MAX_ITER + 1, salt: b64(new Uint8Array(16)) })).rejects.toThrow()
  })

  it('base64 round-trip', () => {
    const bytes = new Uint8Array(70_000)
    for (let i = 0; i < bytes.length; i += 60_000) crypto.getRandomValues(bytes.subarray(i, i + 60_000))
    expect(Array.from(unb64(b64(bytes)))).toEqual(Array.from(bytes))
  })

  it('randomInt è uniforme (niente bias del modulo) e nei limiti', () => {
    const n = 7
    const counts = new Array(n).fill(0)
    const N = 70_000
    for (let i = 0; i < N; i++) { const v = randomInt(n); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(n); counts[v]++ }
    for (const c of counts) expect(Math.abs(c - N / n)).toBeLessThan((N / n) * 0.06)
    expect(() => randomInt(0)).toThrow()
  })

  it('il generatore include almeno un carattere per ogni gruppo attivo', () => {
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword({ length: 4, upper: true, lower: true, digits: true, symbols: true })
      expect(pw).toHaveLength(4)
      expect(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)).toBe(true)
    }
    expect(/^\d+$/.test(generatePassword({ length: 30, upper: false, lower: false, digits: true, symbols: false }))).toBe(true)
    expect(() => generatePassword({ ...DEFAULT_GEN, upper: false, lower: false, digits: false, symbols: false })).toThrow()
  })

  it('la lunghezza richiesta è rispettata (8–64)', () => {
    expect(generatePassword({ ...DEFAULT_GEN, length: 8 })).toHaveLength(8)
    expect(generatePassword({ ...DEFAULT_GEN, length: 64 })).toHaveLength(64)
  })

  it('secureShuffle conserva gli elementi e mescola davvero', () => {
    const src = Array.from({ length: 20 }, (_, i) => i)
    const out = secureShuffle(src)
    expect([...out].sort((a, b) => a - b)).toEqual(src)
    // la prima posizione non resta sempre uguale (uniformità grossolana)
    const first = new Set<number>()
    for (let i = 0; i < 200; i++) first.add(secureShuffle(src)[0])
    expect(first.size).toBeGreaterThan(10)
  })

  it('la stima di robustezza cresce con lunghezza e varietà', () => {
    expect(estimateStrength('abc').score).toBeLessThan(estimateStrength('Xk9#mQ2$vL7!pR4z').score)
    expect(estimateStrength('').score).toBe(0)
  })
})

describe('vaultModel', () => {
  const owner = { name: 'Anna', email: 'anna@example.com' }

  async function house() {
    const { file, session } = await createVault('Casa', owner, FAM, ANNA)
    // Anna invita Bruno (voce nell'elenco, senza blocco personale)
    const bruno = makeMember({ name: 'Bruno', email: 'bruno@example.com' }, 1)
    return { file: upsertMember(file, bruno), annaSession: session, bruno }
  }

  it('il file non contiene nulla in chiaro', async () => {
    const { file, session } = await createVault('Casa', owner, FAM, ANNA)
    session.common.entries.push(entry('e1', { title: 'SegretissimoTitolo', password: 'SegretissimaPassword' }))
    session.personal.entries.push(entry('e2', { title: 'TitoloPersonale', password: 'PwPersonale' }))
    const sealed = await sealFile(file, session, { common: true, personal: true })
    const text = JSON.stringify(sealed)
    for (const s of ['SegretissimoTitolo', 'SegretissimaPassword', 'TitoloPersonale', 'PwPersonale', FAM, ANNA, 'Streaming']) expect(text).not.toContain(s)
  })

  it('sblocca con le password giuste e distingue quella sbagliata', async () => {
    const { file } = await house()
    const id = file.members[0].id
    const ok = await unlockVault(file, id, FAM, ANNA)
    expect(ok.setup).toBe(false)
    expect(ok.session.common.categories.length).toBeGreaterThan(3)
    await expect(unlockVault(file, id, 'sbagliata', ANNA)).rejects.toMatchObject({ which: 'common' })
    await expect(unlockVault(file, id, FAM, 'sbagliata')).rejects.toBeInstanceOf(UnlockError)
    await expect(unlockVault(file, id, FAM, 'sbagliata')).rejects.toMatchObject({ which: 'personal' })
  })

  it('un membro non può leggere le voci personali di un altro', async () => {
    const { file, annaSession, bruno } = await house()
    annaSession.personal.entries.push(entry('segreta', { title: 'Conto di Anna' }))
    const sealed = await sealFile(file, annaSession, { personal: true })
    // Bruno prova con la sua password personale e con quella di Anna (che non conosce)
    const b = await unlockVault(sealed, bruno.id, FAM, BRUNO)
    expect(b.setup).toBe(true)
    expect(b.session.personal.entries).toHaveLength(0)
    // il blocco personale di Anna non si apre con la password di Bruno, nemmeno conoscendo la password di famiglia
    await expect(unlockVault(sealed, sealed.members[0].id, FAM, BRUNO)).rejects.toMatchObject({ which: 'personal' })
  })

  it('i blocchi non si possono scambiare tra posizioni (AAD)', async () => {
    const { file, annaSession, bruno } = await house()
    const sealed = await sealFile(file, annaSession, { personal: true })
    const annaRec = sealed.members.find((m) => m.email === owner.email)!
    // un writer malevolo copia il blocco personale di Anna nel record di Bruno: non si decifra nemmeno con la chiave giusta
    const swapped = upsertMember(sealed, { ...bruno, personal: annaRec.personal })
    await expect(unlockVault(swapped, bruno.id, FAM, ANNA)).rejects.toMatchObject({ which: 'personal' })
  })

  it('il merge di Bruno non tocca il blocco personale di Anna (byte per byte)', async () => {
    const { file, annaSession, bruno } = await house()
    annaSession.personal.entries.push(entry('a1', { title: 'Privata di Anna' }))
    const remote = await sealFile(file, annaSession, { personal: true })
    const annaBlock = remote.members.find((m) => m.email === owner.email)!.personal!

    // Bruno parte da una copia più vecchia (senza il blocco personale aggiornato di Anna), sblocca e aggiunge una voce comune
    const b = await unlockVault(file, bruno.id, FAM, BRUNO)
    b.session.common.entries.push(entry('c1', { title: 'Wi-Fi', createdBy: bruno.id }))
    const local = await sealFile(b.file, b.session, { common: true, personal: true })
    const merged = await mergeFiles(local, remote, b.session)

    const annaAfter = merged.file.members.find((m) => m.email === owner.email)!.personal!
    expect(annaAfter).toEqual(annaBlock)
    expect(merged.session!.common.entries.map((e) => e.id)).toContain('c1')
    // e Anna, riaprendo il file unito, vede ancora le sue voci e quella di Bruno
    const again = await unlockVault(merged.file, annaSession.memberId, FAM, ANNA)
    expect(again.session.personal.entries.map((e) => e.id)).toEqual(['a1'])
    expect(again.session.common.entries.map((e) => e.id)).toContain('c1')
  })

  it('il merge conserva le modifiche concorrenti su record diversi e rispetta i tombstone', async () => {
    const { file, annaSession } = await createVault('Casa', owner, FAM, ANNA).then(async (r) => ({ file: r.file, annaSession: r.session }))
    annaSession.common.entries.push(entry('x'), entry('y'))
    const base = await sealFile(file, annaSession, { common: true })

    // due dispositivi di Anna partono dalla stessa base
    const dev1: Session = { ...annaSession, common: { ...annaSession.common, entries: [...annaSession.common.entries] } }
    dev1.common.entries = dev1.common.entries.map((e) => (e.id === 'x' ? { ...e, title: 'X1', updatedAt: 10 } : e))
    const f1 = await sealFile(base, dev1, { common: true })
    const dev2: Session = { ...annaSession, common: { ...annaSession.common, entries: annaSession.common.entries.map((e) => (e.id === 'y' ? tombstoneEntry(e, 20) : e)) } }
    const f2 = await sealFile(base, dev2, { common: true })

    const m12 = await mergeFiles(f1, f2, dev1)
    const m21 = await mergeFiles(f2, f1, dev2)
    for (const m of [m12, m21]) {
      const byId = Object.fromEntries(m.session!.common.entries.map((e) => [e.id, e]))
      expect(byId.x.title).toBe('X1')
      expect(byId.y.deleted).toBe(true)
    }
    expect(m12.session!.common.entries).toEqual(m21.session!.common.entries) // commutativo
    // idempotente
    const again = await mergeFiles(m12.file, m12.file, m12.session)
    expect(again.session!.common.entries).toEqual(m12.session!.common.entries)
  })

  it('mergeRecords: ultima scrittura vince, tombstone inclusi', () => {
    const a = [entry('1', { title: 'A', updatedAt: 5 })]
    const b = [entry('1', { title: 'B', updatedAt: 9 })]
    expect(mergeRecords(a, b)[0].title).toBe('B')
    expect(mergeRecords(b, a)[0].title).toBe('B')
    expect(mergeRecords([tombstoneEntry(a[0], 20)], b)[0].deleted).toBe(true)
  })

  it('cambio Password di Famiglia: la vecchia non sblocca, le password personali restano valide', async () => {
    const { file, annaSession } = await house()
    const { file: f2, session: s2 } = await changeFamilyPassword(file, annaSession, 'nuova-password-famiglia')
    await expect(unlockVault(f2, annaSession.memberId, FAM, ANNA)).rejects.toMatchObject({ which: 'common' })
    const ok = await unlockVault(f2, annaSession.memberId, 'nuova-password-famiglia', ANNA)
    expect(ok.session.common.categories.length).toBe(s2.common.categories.length)
  })

  it('un dispositivo con la vecchia chiave non può sovrascrivere né unire il blocco rinnovato', async () => {
    const { file, annaSession } = await house()
    const { file: rotated } = await changeFamilyPassword(file, annaSession, 'nuova-password-famiglia')
    await expect(mergeFiles(file, rotated, annaSession)).rejects.toBeInstanceOf(KeyMismatchError)
    await expect(reopen(rotated, annaSession)).rejects.toBeInstanceOf(KeyMismatchError)
  })

  it('cambio password personale', async () => {
    const { file, annaSession } = await house()
    const { file: f2 } = await changePersonalSecret(file, annaSession, 'altra-password-personale')
    await expect(unlockVault(f2, annaSession.memberId, FAM, ANNA)).rejects.toMatchObject({ which: 'personal' })
    await unlockVault(f2, annaSession.memberId, FAM, 'altra-password-personale')
    expect(await verifyPersonalSecret(f2, annaSession.memberId, 'altra-password-personale')).toBe(true)
    expect(await verifyPersonalSecret(f2, annaSession.memberId, ANNA)).toBe(false)
  })

  it('rimuovere un membro elimina il suo blocco personale e il tombstone vince nel merge', async () => {
    const { file, bruno } = await house()
    const b = await unlockVault(file, bruno.id, FAM, BRUNO)
    const withBruno = b.file
    expect(withBruno.members.find((m) => m.id === bruno.id)!.personal).toBeTruthy()
    const removed = removeMember(withBruno, bruno.id)
    const merged = await mergeFiles(withBruno, removed, null)
    const rec = merged.file.members.find((m) => m.id === bruno.id)!
    expect(rec.deleted).toBe(true)
    expect(rec.personal).toBeNull()
  })

  it('solo l\'autore o il Capofamiglia modificano una voce comune', () => {
    const e = entry('1', { createdBy: 'bruno' })
    expect(canEditCommon(e, 'bruno', false)).toBe(true)
    expect(canEditCommon(e, 'carla', false)).toBe(false)
    expect(canEditCommon(e, 'carla', true)).toBe(true)
  })
})
