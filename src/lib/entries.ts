import { GENERAL_CATEGORY_ID, type Category, type Entry, type MemberRec, type Scope } from '../types'
import type { Session } from '../services/vaultModel'

export interface Item { entry: Entry; scope: Scope; category: Category; author: string }

export const liveCategories = (s: Session): Category[] => s.common.categories.filter((c) => !c.deleted)

/** Voci visibili a chi è sbloccato: tutte le comuni + le proprie personali. Le categorie sparite ricadono su «Generale». */
export function listItems(s: Session, members: MemberRec[]): Item[] {
  const cats = liveCategories(s)
  const byId = new Map(cats.map((c) => [c.id, c]))
  const general = byId.get(GENERAL_CATEGORY_ID) ?? { id: GENERAL_CATEGORY_ID, name: 'Generale', icon: 'Folder', color: '#5b6577', updatedAt: 0 }
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? '—'
  const mk = (scope: Scope) => (e: Entry): Item => ({ entry: e, scope, category: byId.get(e.categoryId) ?? general, author: name(e.createdBy) })
  return [...s.common.entries.filter((e) => !e.deleted).map(mk('common')), ...s.personal.entries.filter((e) => !e.deleted).map(mk('personal'))]
    .sort((a, b) => a.entry.title.localeCompare(b.entry.title, 'it', { sensitivity: 'base' }))
}
