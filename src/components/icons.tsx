import {
  AtSign, Briefcase, Car, CreditCard, Film, Folder, Gamepad2, GraduationCap, Heart, Home, Landmark, Mail, Plane, ShieldCheck,
  ShoppingBag, Smartphone, Tv, Wifi, type LucideIcon,
} from 'lucide-react'

/** Icone Lucide selezionabili per le categorie (il nome è salvato nel file). */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Folder, Tv, Home, Landmark, AtSign, Wifi, ShoppingBag, Heart, Car, Briefcase, Plane, Gamepad2, GraduationCap, ShieldCheck, Smartphone, Mail, CreditCard, Film,
}
export const iconFor = (name: string): LucideIcon => CATEGORY_ICONS[name] ?? Folder

/** Colori scelti dall'utente (dati, non token): caldi e leggibili con icone bianche su entrambi i temi. */
export const PICK_COLORS = ['#c9692a', '#2a8f78', '#c0506a', '#e0a93e', '#8a5fa8', '#3f87b8', '#6aa84f', '#5b6577']

export function autoColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PICK_COLORS[h % PICK_COLORS.length]
}
