# Worker di accesso persistente (facoltativo)

Senza Worker l'app funziona già: l'accesso a Google dura circa un'ora e si rinnova con un popup. Con il Worker l'accesso resta attivo
(180 giorni di inattività) e i token si rinnovano da soli, senza popup, anche in background.

**Cosa fa:** fa da intermediario OAuth. Scambia il codice di Google con il *client secret* (che non può stare nel browser), conserva il
token di rinnovo **cifrato** (AES-GCM) in un archivio KV e dà all'app solo token d'accesso freschi di un'ora.
**Cosa non fa:** non vede, non riceve e non conserva la cassaforte, né le password, né le chiavi. Passa dal Worker solo l'identificativo di
sessione e i token Google.

Rispetto a Clean Duo / MoneyDuo il Worker è volutamente ridotto: niente notifiche push, niente «ponte» verso il file, niente dispositivi.

| Endpoint | Metodo | Scopo |
|---|---|---|
| `/health` | GET | `{ok:true, auth:<configurato?>}` |
| `/auth/start` · `/auth/callback` | GET | login OAuth (Google rimanda a `/auth/callback`) |
| `/auth/refresh` · `/auth/logout` | POST | token fresco / chiusura della sessione di questo dispositivo (Bearer = id sessione) |

## Installazione (una volta sola)

```bash
node worker/scripts/generate-session-key.mjs   # stampa SESSION_KEY
cd worker && cp wrangler.example.toml wrangler.toml
# in wrangler.toml: ALLOWED_ORIGINS="https://<utente>.github.io,http://localhost:5173" e GOOGLE_CLIENT_ID
npx wrangler login
npx wrangler kv namespace create SUBS          # incolla l'id in wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_KEY
npx wrangler deploy                            # poi apri <url>/health → {"ok":true,"auth":true}
```

Poi:

1. In Google Cloud, nell'ID client OAuth, aggiungi tra gli **URI di reindirizzamento autorizzati** `https://<worker>.workers.dev/auth/callback`.
2. Su GitHub aggiungi la variabile `VITE_AUTH_URL` = URL del Worker (senza `/` finale) e rilancia il deploy.

**Sicurezza:** chi controlla il tuo account Cloudflare potrebbe usare i token di rinnovo: attiva la verifica in due passaggi. Se perdi o cambi
`SESSION_KEY` le sessioni vanno rifatte. Per revocare tutto: <https://myaccount.google.com/permissions>.
