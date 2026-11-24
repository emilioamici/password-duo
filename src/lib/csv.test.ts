import { describe, expect, it } from 'vitest'
import { applyMapping, autoMap, categoryFor, parseCsv, parseJsonTable } from './csv'

describe('csv', () => {
  it('gestisce virgolette, "" e a-capo nei campi', () => {
    const rows = parseCsv('"Account","Login Name","Password","Comments"\r\n"Net ""flix""","me@x.it","p,w","riga1\nriga2"\r\nb,u,pw,\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(['Net "flix"', 'me@x.it', 'p,w', 'riga1\nriga2'])
    expect(rows[2]).toEqual(['b', 'u', 'pw', ''])
  })
  it('riconosce il punto e virgola e il BOM', () => {
    expect(parseCsv('﻿title;password\na;b')[1]).toEqual(['a', 'b'])
  })
  it('mappa le colonne KeePass e applica la mappatura', () => {
    const rows = parseCsv('"Group","Title","Username","Password","URL","Notes"\n"Banche","Intesa","u","pw","https://x.it","n"')
    const map = autoMap(rows[0])
    expect(map).toMatchObject({ title: 1, username: 2, password: 3, url: 4, notes: 5, group: 0 })
    expect(applyMapping(rows.slice(1), map)[0]).toMatchObject({ title: 'Intesa', password: 'pw', group: 'Banche' })
  })
  it('JSON annidato (Bitwarden) diventa tabella', () => {
    const t = parseJsonTable(JSON.stringify({ items: [{ name: 'A', login: { username: 'u', password: 'p', uris: [{ uri: 'https://a.it' }] } }] }))
    const map = autoMap(t[0])
    expect(applyMapping(t.slice(1), map)[0]).toMatchObject({ title: 'A', username: 'u', password: 'p', url: 'https://a.it' })
  })
  it('i gruppi sconosciuti finiscono in Generale', () => {
    const cats = [{ id: 'finance', name: 'Finanza & Banche' }]
    expect(categoryFor('finanza & banche', cats)).toBe('finance')
    expect(categoryFor('Root/Altro', cats)).toBe('general')
  })
})
