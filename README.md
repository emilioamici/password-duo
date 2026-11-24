# Password Duo

Password manager **familiare**, client-side e a conoscenza zero, ispirato a KeePass: un unico file JSON **cifrato** nel Google Drive del Capofamiglia,
condiviso con i familiari. Progressive Web App mobile-first (React + Vite + TypeScript + Tailwind 3), pubblicabile su GitHub Pages.

Stile grafico, autenticazione Google e regole di invito derivano da [Clean Duo](https://github.com/emilioamici/clean-duo) e
[MoneyDuo](https://github.com/emilioamici/money-duo): tema Mochi (chiaro) / Zenitsu (scuro), Liquid Glass solo su navigazione e fogli, i due gattini.

> **Stato dell'icona e delle mascotte:** sono quelle provvisorie di Clean Duo (`public/app-icon.png`, `public/cats/*`). Quando arriva l'icona
> definitiva si sostituiscono i file e si rigenerano `pwa-*.png`, `apple-touch-icon.png` e `favicon.png`.

## Funzioni

- **Cassaforte:** ricerca istantanea, filtro per ambito (Tutte / Comuni / Personali), filtro per categoria, copia rapida di username e password.
- **Voci:** titolo, categoria, ambito (Personale o Comune), username, password (mostra/nascondi, copia), sito, note sicure, colore. Chi crea una voce
  *comune* (o il Capofamiglia) può modificarla; gli altri la usano in sola lettura.
- **Generatore:** casuale crittografico, lunghezza 8–64, maiuscole/minuscole/numeri/simboli, indicatore di robustezza, uso in un tocco; controllo di una password esistente.
- **Categorie:** comuni a tutta la famiglia; solo il Capofamiglia le crea, rinomina, ricolora ed elimina (le voci di una categoria eliminata passano a «Generale»).
- **Famiglia e sicurezza:** stato di Drive, inviti, blocco automatico configurabile, «Blocca ora», cambio delle password, backup e importazione.
- **Importazione/Esportazione:** CSV o JSON (KeePass, Bitwarden, Chrome…) con anteprima e mappatura dei campi; esportazione del file cifrato `.enc.json`.
- **Offline:** copia locale cifrata in IndexedDB; sincronizzazione automatica all'apertura, dopo ogni modifica (2 s), al ritorno in primo piano, quando torna la rete e ogni 2 minuti; pulsante «Sync» manuale.
- **Solo locale:** si può usare anche senza Google (cassaforte solo sul dispositivo) e collegarla a Drive in seguito.

## Modello crittografico

Tutto avviene nel browser con la **Web Crypto API** nativa. Su Drive, nella cache locale e nel Worker non esiste mai testo in chiaro di password,
note, titoli, categorie o chiavi.

### Primitive

| Cosa | Scelta |
|---|---|
| Derivazione della chiave | **PBKDF2-SHA256**, **600.000 iterazioni** (il minimo richiesto era 300.000), salt casuale di 16 byte **per ogni blocco** |
| Cifratura | **AES-GCM a 256 bit**, IV casuale di 12 byte **nuovo a ogni cifratura** (mai riusato con la stessa chiave) |
| Dati autenticati (AAD) | legati alla posizione del blocco: `fv1\|common\|<vaultId>` e `fv1\|personal\|<vaultId>\|<memberId>` |
| Chiavi in memoria | `CryptoKey` **non esportabili** (`extractable: false`) |
| Numeri casuali | `crypto.getRandomValues` con campionamento per scarto (nessun bias del modulo) e Fisher-Yates crittografico per il mescolamento |

I parametri della derivazione (`alg`, `iter`, `salt`) stanno dentro ogni blocco, così si potranno aggiornare in futuro. Quando si legge un file altrui le
iterazioni accettate sono limitate a 100.000–5.000.000.

### Struttura del file `family-vault-db.enc.json`

```
{ schema, version, vaultId, houseName, lastUpdated,
  common:  { rev, updatedAt, kdf{salt,iter}, iv, ct },        ← categorie + voci COMUNI, chiave = Password di Famiglia
  members: [ { id, name, email, color, avatar, updatedAt, deleted?,
               personal: { rev, updatedAt, kdf, iv, ct } } ] } ← voci PERSONALI di quel membro, chiave = sua password personale
```

- **Blocco comune:** cifrato con una chiave derivata dalla **Password di Famiglia**, condivisa a voce tra i familiari. Contiene le categorie e le voci comuni.
- **Blocco personale:** ogni membro ha il suo, cifrato con una chiave derivata dalla **sua password personale**, **indipendente** dalla Password di Famiglia.
  Anche se il file è condiviso con tutta la famiglia, ognuno decifra solo il blocco comune e il proprio; i blocchi degli altri restano illeggibili.
  Un effetto utile: cambiare la Password di Famiglia non obbliga nessuno a ricifrare le proprie password personali.
- **Elenco membri in chiaro:** nome, email, colore e avatar. Servono per riconoscere chi sei (l'email dell'account Google) *prima* dello sblocco.
  Non sono segreti (chi ha il file su Drive vede già chi lo condivide). Quindi il file rivela *chi* fa parte della famiglia, il numero e la dimensione dei
  blocchi e gli orari di modifica, ma non il contenuto.
- **Blocchi non scambiabili:** grazie all'AAD, copiare il blocco personale di Anna nel record di Bruno (o viceversa) fa fallire la decifrazione: non si
  possono spostare blocchi tra posizioni.

### Flusso di sblocco

1. Si deriva la chiave comune dalla Password di Famiglia e quella personale dalla password personale (in parallelo, usando i `salt` salvati nei blocchi).
2. Si decifrano il blocco comune e il proprio blocco personale. Se uno fallisce l'app dice **quale** password è sbagliata.
3. Al **primo accesso dopo un invito** il membro non ha ancora un blocco personale: sceglie la sua password personale e il blocco viene creato.
4. I dati in chiaro e le chiavi vivono **solo in memoria**.

### Blocco automatico

La cassaforte si blocca dopo **N minuti di inattività** (1, 2, 5, 10 o 15, configurabile; predefinito 2), quando l'app resta in **background** oltre 20
secondi (disattivabile) e con «Blocca ora». Il blocco aspetta che le modifiche in corso siano ricifrate e poi butta sessione, chiavi e dati in chiaro.
La copia locale e quella su Drive sono **sempre** cifrate: ogni modifica ricifra subito il blocco interessato, quindi il blocco non perde nulla.

> Limite del browser: JavaScript non permette di sovrascrivere la memoria. Al blocco si eliminano i riferimenti e si lascia fare al *garbage collector*; le
> chiavi sono comunque non esportabili. Se la sicurezza del dispositivo è compromessa (malware, estensioni ostili) nessuna app web può proteggerti.

### Password di Famiglia e personale: cosa scegliere

- La Password di Famiglia richiede almeno **10 caratteri**, la personale almeno **8**. Preferisci **frasi lunghe**.
- **Niente PIN a 4 cifre:** chiunque abbia il file (cioè tutta la famiglia) può provare a indovinare la password personale degli altri **offline**, senza limiti
  di tentativi. 600.000 iterazioni rallentano l'attacco, non lo impediscono per segreti corti.
- **Non esiste recupero.** Se dimentichi la Password di Famiglia nessuno può decifrare le voci comuni; se dimentichi la personale perdi le tue voci personali.
  Conserva un backup cifrato e le password in un posto sicuro.

## Ruoli e regole di invito

- **Capofamiglia = proprietario del file su Drive.** Il ruolo si ricava ogni volta dai metadati di Drive (`owners`) confrontati con l'email dell'account: non da un campo
  nel file, che qualunque familiare con permesso di scrittura potrebbe modificare. Il file è creato con `writersCanShare: false`: **solo il proprietario può invitare o togliere persone**.
- **Invito:** *Famiglia → Membri e condivisione → Invita*. L'app condivide il file con ruolo `writer` (Drive manda l'email con il link) e aggiunge il membro all'elenco.
  Chi riceve l'invito apre il link, accede con **quell'account Google**, e viene associato al membro tramite l'email (mai duplicati). Con il permesso ristretto `drive.file` il
  primo ingresso richiede un tocco sul **selettore di Google** (Picker), che mostra solo quel file: è **obbligatorio** per ogni invitato (vedi «Setup Google Cloud»). ID famiglia o link incollati nel Gate servono a indicare quale file mostrare nel Picker.
- **La Password di Famiglia non viaggia con l'invito:** va comunicata di persona.
- **Rimozione:** il Capofamiglia revoca il permesso su Drive e segna il membro come rimosso (il suo blocco personale viene eliminato dal file). Poiché la persona
  conosceva la Password di Famiglia e può avere una copia vecchia del file, **l'app consiglia di cambiare la Password di Famiglia** subito dopo.
- **Categorie:** solo il Capofamiglia vede i controlli di modifica; gli altri vedono il badge «Gestite dal Capofamiglia». *Limite:* è un controllo dell'interfaccia. Un
  familiare con permesso di scrittura e conoscenza della Password di Famiglia potrebbe, con strumenti propri, riscrivere il blocco comune. Per un'applicazione crittografica serve
  una firma del Capofamiglia sulle categorie (non implementata, vedi «Decisioni»).
- **Voci comuni:** può modificarle o eliminarle chi le ha create oppure il Capofamiglia (`createdBy`).
- **Importazione di un membro:** non crea categorie; i gruppi sconosciuti finiscono in «Generale». Le voci importate partono come **Personali**.

## Sincronizzazione e conflitti

Motore in `src/store/VaultContext.tsx`, Drive in `src/services/googleDriveService.ts`, merge in `src/services/vaultModel.ts`.

- **Controllo di versione.** Prima di scrivere si legge la `version` del file su Drive (quella che il testo chiama «versione / `headRevisionId`»: cambia a ogni scrittura) e
  si confronta con quella letta. Se è cambiata, si rilegge, si **uniscono** le modifiche e si riprova (fino a 5 volte).
- **Merge per record:** vince l'`updatedAt` più recente, a parità una scelta deterministica; le cancellazioni sono *tombstone* e non vengono mai rimosse. Il merge è commutativo e idempotente (c'è un test).
- **Un dispositivo non ricostruisce mai il file dai propri dati.** Decifra solo il blocco comune e il proprio; i blocchi personali degli altri vengono copiati **byte per byte** e, se due
  copie sono in conflitto, vince quella con `rev` più alto (c'è un test: il merge di Bruno non tocca il blocco di Anna).
- **Non si carica mai** quando: la copia locale è assente o non allineata (si adotta Drive); il blocco comune remoto non si decifra con la chiave in memoria (la Password di Famiglia
  è stata cambiata altrove: si blocca e si chiede la nuova); la cassaforte è bloccata e Drive è cambiato (non si può unire senza chiavi: si attende lo sblocco).
- **Una sync non apre né sovrascrive nulla di nuovo.** Ogni passata lavora su una «fotografia» di file e sessione: se durante le attese di rete cambia qualcosa (una modifica, un blocco, uno sblocco) non si applica niente e si riparte. Una sync lenta non può quindi riaprire una cassaforte appena bloccata (c'è un test).
- **Password cambiata altrove con modifiche non sincronizzate:** si adotta la copia di Drive, la copia locale viene **messa da parte** (cifrata, in IndexedDB) e dopo il nuovo sblocco si recuperano i blocchi la cui chiave non è cambiata. Le voci *personali* scritte offline sopravvivono a un cambio della Password di Famiglia; le voci *comuni* modificate offline in quel caso no (sono cifrate con la chiave vecchia) e l'app lo dice.
- **Errori:** sessione scaduta → «Riconnetti» (con possibilità di continuare offline); rete assente → stato Offline e nuovo tentativo; sola lettura → errore esplicito, nessun upload.

> Resta una finestra di millisecondi tra il controllo di versione e la scrittura: Drive non ha un «if-match». Non è una perdita permanente: l'altro dispositivo conserva le sue modifiche e le
> ri-fonde alla sync successiva.

## Setup Google Cloud

1. Crea un progetto su <https://console.cloud.google.com> e abilita **Google Drive API** (e **Google Picker API** per il selettore).
2. **Schermata di consenso OAuth:** tipo *Esterno*, scope `https://www.googleapis.com/auth/drive.file` (non sensibile: nessuna verifica). Per l'accesso persistente
   con il Worker **pubblica l'app** (in *Testing* i token di rinnovo scadono dopo 7 giorni). Finché non è verificata compare «app non verificata»: *Avanzate → Vai a Password Duo*.
3. **Credenziali → ID client OAuth → Applicazione web.** Origini JavaScript autorizzate: `http://localhost:5173` e `https://<utente>.github.io` (solo schema e dominio).
   Se usi il Worker, aggiungi tra gli URI di reindirizzamento `https://<worker>.workers.dev/auth/callback`.
4. **Picker (necessario per i familiari invitati).** Con il permesso ristretto `drive.file` l'app vede solo i file che ha creato o che l'utente ha scelto con il selettore di Google: un invitato non può aprire il file né col link né con l'ID finché non lo sceglie una volta nel **Picker**. Abilita la **Google Picker API**, crea una **chiave API** limitata a quella API e annota il **numero del progetto** (è l'`APP_ID`). Senza Picker il Capofamiglia usa l'app normalmente, ma nessun invitato riesce a entrare.
5. Su GitHub: *Settings → Secrets and variables → Actions → **Variables***:

| Variabile | Valore |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | ID client OAuth |
| `VITE_GOOGLE_API_KEY` · `VITE_GOOGLE_APP_ID` | chiave API e numero del progetto (Picker: **obbligatorie per gli invitati**) |
| `VITE_AUTH_URL` | *(facoltativa)* URL del Worker, senza `/` finale |

Sono identificativi **pubblici** (finiscono nel codice del sito), non segreti. Il *client secret* non va mai nel repository: sta solo nel Worker.

## Accesso persistente (Worker, facoltativo)

Vedi [`worker/README.md`](worker/README.md). Senza Worker l'accesso a Google dura un'ora: l'app lo rinnova in modo silenzioso (`prompt: 'none'`) al primo tocco quando restano meno di 15 minuti, e se Google richiede il consenso compare «Riconnetti». Con il Worker l'accesso dura 180 giorni di
inattività, senza popup. Il Worker non vede la cassaforte: conserva solo i token di rinnovo di Google, cifrati.

## Sviluppo

```bash
npm install
cp .env.example .env.local   # inserisci i tuoi identificativi Google (facoltativo per provare in locale)
npm run dev                  # http://localhost:5173
npm test                     # crittografia, merge, CSV, Worker
npm run build                # controlla i tipi (tsc) e costruisce in dist/
```

Senza credenziali Google puoi comunque provare l'app con **«Usa solo su questo dispositivo»**.

### Struttura

```
src/services/cryptoService.ts      Web Crypto: PBKDF2, AES-GCM, generatore, robustezza
src/services/vaultModel.ts         blocchi, sblocco, merge, cambio password, elenco membri
src/services/googleDriveService.ts Drive v3, GIS, Picker, condivisione
src/services/broker.ts · invite.ts accesso persistente (Worker) e link d'invito
src/services/cache.ts              copia locale cifrata (IndexedDB)
src/store/VaultContext.tsx         stato, sincronizzazione, blocco automatico
src/components/                    interfaccia (Gate, UnlockScreen, Vault/Generator/Categories/Family, fogli)
src/lib/                           CSV/JSON, appunti, tema
worker/                            Cloudflare Worker (solo accesso persistente)
```

## Deploy su GitHub Pages

`.github/workflows/deploy.yml` costruisce e pubblica a ogni push su `main`. In *Settings → Pages* imposta **Source: GitHub Actions**.
`vite.config.ts` calcola il `base` dal nome del repository (`/<repo>/`, oppure `/` se il repo è `<utente>.github.io`); in locale è `/`. Si può forzare con `VITE_BASE`.

## Decisioni

- **Un solo file, due tipi di blocco.** Rispetta il requisito di un database condiviso su Drive con voci comuni e personali nello stesso JSON.
- **Chiave personale indipendente dalla Password di Famiglia**, per poter cambiare l'una senza toccare l'altra.
- **Capofamiglia = proprietario del file su Drive**, non un campo del file (un campo sarebbe falsificabile da chi ha accesso in scrittura).
- **Modifica delle voci comuni:** solo l'autore o il Capofamiglia (scelta mia, la specifica non la fissava).
- **Categorie non firmate.** Una firma digitale del Capofamiglia sulle categorie darebbe una garanzia crittografica oltre all'interfaccia; non è stata aggiunta per non
  complicare il modello (richiede di fissare la chiave pubblica al primo uso). È il primo miglioramento consigliato.
- **Niente Content-Security-Policy** nel `index.html`: Google Identity Services e il Picker caricano script e frame da più domini e un CSP troppo stretto li romperebbe in modo silenzioso
  (non verificabile senza un progetto Google reale). Per una messa in produzione seria è una difesa in profondità raccomandata contro lo XSS.
- **Tema:** tre scelte (Automatico / Mochi / Zenitsu) in *Famiglia → Aspetto*; `prefers-reduced-motion` ferma lo sfondo animato.
- **Pulizia degli appunti: best effort.** Il browser può rifiutare `writeText('')` se la pagina non ha il focus.
- **Tombstone senza scadenza:** le cancellazioni restano nel file (svuotate di ogni contenuto: nessun segreto), per evitare che una voce risorga da un dispositivo rimasto indietro.
- **Solo italiano**, niente catalogo di traduzioni (Clean Duo ne ha uno it/en).
- **Worker ridotto** all'accesso persistente: niente notifiche, ponte, Tuya. Senza il ponte, chi entra in famiglia deve passare dal Picker (un tocco, una volta sola).
- **Mascotte e icona provvisorie** (quelle di Clean Duo, con scopa e piumino), in attesa dell'icona definitiva.

## Prove nel browser (Playwright)

Servono Playwright e Chromium. Costruisci e avvia l'anteprima, poi lancia gli script:

```bash
npm run build && npx vite preview --port 4173 &
node e2e/locale.cjs       # cassaforte locale: crea, aggiungi, blocca/sblocca, temi chiaro e scuro
node e2e/drive-e2e.cjs    # due dispositivi (Capofamiglia + invitato) contro un Google Drive simulato in memoria
```

## Cosa è stato verificato (e cosa no)

**Automatico (31 test):** cifratura/decifrazione con AAD, IV sempre nuovi, parametri KDF fuori intervallo, generatore (almeno un carattere per gruppo, lunghezza, uniformità, mescolamento),
file senza testo in chiaro, sblocco e distinzione tra le due password, isolamento dei blocchi personali, AAD contro lo scambio di blocchi, merge che non tocca i blocchi altrui,
merge commutativo/idempotente con tombstone, cambio delle due password, rimozione di un membro, parser CSV/JSON, endpoint del Worker.

**In browser (Playwright, iPhone 14):** con Google Drive **simulato** (script `e2e/drive-e2e.cjs`, due dispositivi): creazione della famiglia con `writersCanShare:false`, invito, ingresso di Bruno senza duplicati, isolamento delle voci personali, nessun testo in chiaro nel file su Drive, convergenza di modifiche concorrenti, ricarica con copia locale cifrata, una sync lenta che non riapre una cassaforte bloccata, bozza di una voce che non si azzera con una sync in background, cambio della Password di Famiglia (l'altro dispositivo si blocca, non scrive con la chiave vecchia e recupera le voci personali scritte offline), rimozione di un membro. Il Drive simulato è più permissivo di `drive.file`: elenca ed apre i file condivisi senza Picker, quindi **non** prova il passaggio dal selettore di Google. Con la cassaforte locale (`e2e/locale.cjs`, tema chiaro e scuro): creazione di una cassaforte locale, aggiunta di voci personali e comuni, nessun testo in chiaro in IndexedDB, blocco/sblocco con password
sbagliata e giusta, ricarica, mostra/nascondi, nessuna sfocatura sulle card (solo su nav e fogli), nessuno scorrimento orizzontale.

**Non verificato:** OAuth e Drive **reali** (le prove usano un Drive simulato che replica solo le chiamate usate dall'app), Picker reale, deploy reale del Worker, invito reale tra due account, sincronizzazione tra due dispositivi veri. Sono i primi passi da fare dopo il setup.
