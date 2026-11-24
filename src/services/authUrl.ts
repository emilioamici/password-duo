/** Indirizzo del Worker per l'accesso persistente (variabile di build VITE_AUTH_URL). Vuoto = accesso con popup di Google. */
export const authUrl = (): string => ((import.meta.env.VITE_AUTH_URL as string | undefined) || '').trim().replace(/\/+$/, '')
