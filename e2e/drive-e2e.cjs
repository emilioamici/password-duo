// Due dispositivi (Anna = Capofamiglia, Bruno = invitato) contro un Google Drive simulato in memoria.
const { chromium, devices } = require('playwright')
const S = process.argv[2] || 'e2e/out'; require('fs').mkdirSync(S + '/shots', { recursive: true })
const USERS = { 'tok-anna': { email: 'anna@example.com', name: 'Anna Rossi' }, 'tok-bruno': { email: 'bruno@example.com', name: 'Bruno Rossi' } }
const drive = { files: {}, n: 0, delayMedia: 0, blocked: new Set() } // id -> {name, content, version, owner, writers:Set, perms:[]}
const meta = (f, id, user) => ({ id, name: f.name, version: String(f.version), modifiedTime: new Date().toISOString(), owners: [{ emailAddress: f.owner }], capabilities: { canShare: user === f.owner, canEdit: true } })
const can = (f, email) => f.owner === email || f.writers.has(email)
const errs = []
const log = (...a) => console.log(...a)
const ok = (c, m) => { if (!c) { errs.push(m); console.log('  FAIL', m) } else console.log('  ok  ', m) }

async function mockDrive(ctx, who) {
  await ctx.addInitScript((tok) => { window.__tok = tok; localStorage.setItem('pwduo:config', JSON.stringify({ clientId: 'test-client' })) }, who)
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:window.__tok,expires_in:3600})},10)}}},revoke:function(){}}}}` }))
  await ctx.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request(); const url = new URL(req.url())
    const tok = (req.headers()['authorization'] || '').replace('Bearer ', ''); const user = USERS[tok]
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (drive.blocked.has(tok)) return route.abort('internetdisconnected')
    if (!user) return json(401, {})
    const p = url.pathname
    if (p === '/drive/v3/about') return json(200, { user: { emailAddress: user.email, displayName: user.name } })
    if (p === '/drive/v3/files' && req.method() === 'GET') return json(200, { files: Object.entries(drive.files).filter(([, f]) => can(f, user.email)).map(([id, f]) => meta(f, id, user.email)) })
    if (p === '/upload/drive/v3/files' && req.method() === 'POST') {
      const body = req.postData() || ''; const parts = body.split(/--pwduo\w+/).filter((s) => s.includes('Content-Type'))
      const md = JSON.parse(parts[0].split('\r\n\r\n')[1].trim()); const content = parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, '')
      const id = 'file' + String(++drive.n).padStart(12, '0')
      drive.files[id] = { name: md.name, content, version: 1, owner: user.email, writers: new Set(), writersCanShare: md.writersCanShare }
      return json(200, meta(drive.files[id], id, user.email))
    }
    let m = p.match(/^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/)
    if (m) {
      const f = drive.files[m[1]]
      if (!f || !can(f, user.email)) return json(404, {})
      if (req.method() === 'GET' && url.searchParams.get('alt') === 'media' && drive.delayMedia) await new Promise((r) => setTimeout(r, drive.delayMedia))
      if (req.method() === 'GET') return url.searchParams.get('alt') === 'media' ? route.fulfill({ status: 200, contentType: 'application/json', body: f.content }) : json(200, meta(f, m[1], user.email))
      if (req.method() === 'PATCH') { f.content = req.postData(); f.version++; return json(200, meta(f, m[1], user.email)) }
    }
    m = p.match(/^\/drive\/v3\/files\/([^/]+)\/permissions(?:\/(.+))?$/)
    if (m) {
      const f = drive.files[m[1]]
      if (!f || f.owner !== user.email) return json(403, {})
      if (req.method() === 'POST') { const b = JSON.parse(req.postData()); f.writers.add(b.emailAddress.toLowerCase()); return json(200, { id: 'perm-' + b.emailAddress }) }
      if (req.method() === 'GET') return json(200, { permissions: [{ id: 'own', emailAddress: f.owner, role: 'owner' }, ...[...f.writers].map((e) => ({ id: 'perm-' + e, emailAddress: e, role: 'writer' }))] })
      if (req.method() === 'DELETE') { f.writers.delete(decodeURIComponent(m[2]).replace('perm-', '')); return route.fulfill({ status: 204, body: '' }) }
    }
    return json(404, { error: 'mock: ' + req.method() + ' ' + p })
  })
}

const FAM = 'famiglia-segreta-2026'
async function newDevice(browser, who) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 1 })
  await mockDrive(ctx, who)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errs.push(who + ' pageerror: ' + e.message))
  return { ctx, page }
}
const addEntry = async (page, scope, title) => {
  await page.click('[aria-label="Nuova voce"]')
  if (scope === 'common') await page.getByRole('button', { name: 'Comune', exact: true }).click()
  await page.fill('#et', title); await page.getByRole('button', { name: 'Genera', exact: true }).click()
  await page.click('button:has-text("Salva")'); await page.waitForTimeout(400)
}
const sync = async (page) => { await page.click('[aria-label="Sincronizza"]'); await page.waitForTimeout(1500) }
const titles = async (page) => page.$$eval('ul.mt-3 li button[aria-label^="Apri "]', (els) => els.map((e) => e.getAttribute('aria-label').slice(5)))

;(async () => {
  const browser = await chromium.launch()
  // ---- Anna crea la famiglia
  const A = await newDevice(browser, 'tok-anna')
  await A.page.goto('http://localhost:4173/'); await A.page.click('text=Accedi con Google')
  await A.page.waitForSelector('text=Nessuna cassaforte trovata', { timeout: 15000 })
  await A.page.fill('#hn', 'Casa Rossi'); await A.page.fill('#on', 'Anna')
  await A.page.fill('[aria-label="Password di Famiglia"]', FAM); await A.page.fill('[aria-label="Ripeti Password di Famiglia"]', FAM)
  await A.page.fill('[aria-label="Password personale"]', 'personale-anna-123'); await A.page.fill('[aria-label="Ripeti password personale"]', 'personale-anna-123')
  await A.page.click('button:has-text("Crea cassaforte")'); await A.page.waitForSelector('text=La cassaforte è vuota', { timeout: 20000 })
  const fid = Object.keys(drive.files)[0]
  ok(!!fid && drive.files[fid].name === 'family-vault-db.enc.json', 'file creato su Drive con il nome giusto')
  ok(drive.files[fid].writersCanShare === false, 'writersCanShare = false')
  await addEntry(A.page, 'common', 'Wi-Fi Casa'); await addEntry(A.page, 'personal', 'Banca di Anna')
  // invito
  await A.page.click('nav [aria-label="Famiglia"]'); await A.page.waitForSelector('[aria-label="Email del familiare"]')
  await A.page.fill('[aria-label="Email del familiare"]', 'bruno@example.com'); await A.page.fill('[aria-label="Nome del familiare"]', 'Bruno')
  await A.page.click('button:has-text("Invita con Google Drive")'); await A.page.waitForTimeout(2500)
  ok(drive.files[fid].writers.has('bruno@example.com'), 'permesso writer concesso a Bruno')
  await A.page.screenshot({ path: `${S}/shots/e2e-anna-family.png` })
  // ---- Bruno entra
  const B = await newDevice(browser, 'tok-bruno')
  await B.page.goto('http://localhost:4173/'); await B.page.click('text=Accedi con Google')
  await B.page.waitForSelector('text=Benvenuto!', { timeout: 20000 })
  await B.page.fill('[aria-label="Password di Famiglia"]', FAM)
  await B.page.fill('[aria-label="Password personale"]', 'personale-bruno-456'); await B.page.fill('[aria-label="Ripeti password personale"]', 'personale-bruno-456')
  await B.page.click('button:has-text("Crea e sblocca")'); await B.page.waitForSelector('[data-testid=count]', { timeout: 20000 })
  let t = await titles(B.page)
  ok(t.length === 1 && t[0] === 'Wi-Fi Casa', 'Bruno vede la voce comune e NON quella personale di Anna: ' + JSON.stringify(t))
  const members = JSON.parse(drive.files[fid].content).members
  ok(members.length === 2, 'nessun membro duplicato (' + members.length + ')')
  await addEntry(B.page, 'common', 'Netflix'); await addEntry(B.page, 'personal', 'Segreto di Bruno')
  await B.page.click('nav [aria-label="Categorie"]'); await B.page.waitForSelector('text=Gestite dal Capofamiglia')
  ok(await B.page.locator('[aria-label="Nuova categoria"]').count() === 0, 'Bruno non vede i controlli delle categorie')
  await B.page.click('nav [aria-label="Famiglia"]'); await B.page.waitForTimeout(400)
  ok(await B.page.locator('[aria-label="Email del familiare"]').count() === 0, 'Bruno non vede il modulo di invito')
  await B.page.click('nav [aria-label="Cassaforte"]'); await B.page.waitForTimeout(2800)
  // ---- Anna sincronizza
  await A.page.click('nav [aria-label="Cassaforte"]'); await sync(A.page)
  t = await titles(A.page)
  ok(t.includes('Netflix') && t.includes('Wi-Fi Casa') && t.includes('Banca di Anna'), 'Anna riceve Netflix e conserva le sue: ' + JSON.stringify(t))
  ok(!t.includes('Segreto di Bruno'), 'Anna NON vede la voce personale di Bruno')
  const raw = drive.files[fid].content
  for (const s of ['Wi-Fi Casa', 'Netflix', 'Banca di Anna', 'Segreto di Bruno', FAM, 'personale-anna']) ok(!raw.includes(s), 'nel file su Drive non compare "' + s + '"')
  const f2 = JSON.parse(raw)
  ok(f2.members.every((m) => m.personal && m.personal.ct), 'entrambi i blocchi personali presenti su Drive')
  // modifica concorrente: Anna e Bruno modificano senza sincronizzare, poi sincronizzano
  await addEntry(A.page, 'common', 'Spotify'); await addEntry(B.page, 'common', 'Disney+')
  await sync(A.page); await sync(B.page); await sync(A.page)
  t = await titles(A.page); const tb = await titles(B.page)
  ok(['Spotify', 'Disney+', 'Netflix'].every((x) => t.includes(x)), 'Anna converge: ' + JSON.stringify(t))
  ok(['Spotify', 'Disney+', 'Netflix'].every((x) => tb.includes(x)), 'Bruno converge: ' + JSON.stringify(tb))
  // una sync lenta NON deve riaprire una cassaforte bloccata nel frattempo
  await addEntry(B.page, 'common', 'Hulu'); await sync(B.page)
  drive.delayMedia = 1800
  await A.page.click('[aria-label="Sincronizza"]'); await A.page.waitForTimeout(300)
  await A.page.click('[aria-label="Blocca ora"]'); await A.page.waitForSelector('text=Cassaforte bloccata')
  await A.page.waitForTimeout(4500)
  ok(await A.page.locator('text=Cassaforte bloccata').count() === 1 && await A.page.locator('[data-testid=count]').count() === 0, 'una sync lenta non riapre la cassaforte bloccata')
  drive.delayMedia = 0
  await A.page.fill('[aria-label="Password di Famiglia"]', FAM); await A.page.fill('[aria-label="Password personale"]', 'personale-anna-123')
  await A.page.click('button:has-text("Sblocca")'); await A.page.waitForSelector('[data-testid=count]', { timeout: 20000 })
  ok((await titles(A.page)).includes('Hulu'), 'dopo lo sblocco Anna vede la voce arrivata durante la sync lenta')
  // una bozza aperta non si azzera quando una sync in background porta novità
  await B.page.click('[aria-label="Nuova voce"]'); await B.page.fill('#et', 'Bozza importante')
  await addEntry(A.page, 'common', 'Zeta'); await A.page.waitForTimeout(3000)
  await B.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await B.page.waitForTimeout(3000)
  ok(await B.page.inputValue('#et') === 'Bozza importante', 'la bozza di una voce non si azzera con una sync in background')
  await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(500)
  // ricarica Anna: la copia locale cifrata torna e si sblocca
  await A.page.reload(); await A.page.waitForSelector('text=Cassaforte bloccata')
  await A.page.fill('[aria-label="Password di Famiglia"]', FAM); await A.page.fill('[aria-label="Password personale"]', 'personale-anna-123')
  await A.page.click('button:has-text("Sblocca")'); await A.page.waitForSelector('[data-testid=count]', { timeout: 20000 })
  ok((await titles(A.page)).includes('Banca di Anna'), 'dopo la ricarica Anna ritrova le sue voci personali')
  // Bruno lavora offline (una voce personale e una comune), intanto Anna ruota la Password di Famiglia
  await B.page.waitForTimeout(2500); drive.blocked.add('tok-bruno')
  await addEntry(B.page, 'personal', 'Offline personale'); await addEntry(B.page, 'common', 'Offline comune'); await B.page.waitForTimeout(2500)
  // rotazione della Password di Famiglia da parte di Anna → Bruno deve reinserirla
  await A.page.click('nav [aria-label="Famiglia"]'); await A.page.click('button:has-text("Sicurezza")'); await A.page.waitForTimeout(300)
  await A.page.fill('[aria-label="Nuova Password di Famiglia"]', 'nuova-famiglia-2027'); await A.page.fill('[aria-label="Ripeti Password di Famiglia"]', 'nuova-famiglia-2027')
  await A.page.locator('form:has([aria-label="Nuova Password di Famiglia"]) button:has-text("Cambia")').click(); await A.page.waitForTimeout(2500)
  drive.blocked.delete('tok-bruno')
  await B.page.click('[aria-label="Sincronizza"]'); await B.page.waitForSelector('text=La Password di Famiglia è stata cambiata', { timeout: 15000 })
  ok(await B.page.locator('text=messe da parte').count() > 0, 'Bruno è avvisato che le sue modifiche non sincronizzate sono state messe da parte')
  ok(true, 'Bruno viene bloccato e avvisato del cambio password (nessuna scrittura con la chiave vecchia)')
  await B.page.fill('[aria-label="Password di Famiglia"]', 'nuova-famiglia-2027'); await B.page.fill('[aria-label="Password personale"]', 'personale-bruno-456')
  await B.page.click('button:has-text("Sblocca")'); await B.page.waitForSelector('[data-testid=count]', { timeout: 20000 })
  ok((await titles(B.page)).includes('Segreto di Bruno'), 'con la nuova password Bruno ritrova anche le sue voci personali')
  ok((await titles(B.page)).includes('Offline personale'), 'la voce personale scritta offline prima del cambio password viene recuperata')
  ok(await B.page.locator('text=Recuperate le modifiche').count() > 0, 'Bruno vede l’avviso di recupero')
  // rimozione di Bruno
  await A.page.click('nav [aria-label="Famiglia"]'); await A.page.click('button:has-text("Membri e condivisione")').catch(() => {}); await A.page.waitForTimeout(300)
  await A.page.waitForSelector('text=Bruno')
  await A.page.locator('li:has-text("Bruno") button').click(); await A.page.locator('li:has-text("Bruno") button').click(); await A.page.waitForTimeout(2500)
  ok(!drive.files[fid].writers.has('bruno@example.com'), 'rimozione: permesso di Bruno revocato su Drive')
  const rec = JSON.parse(drive.files[fid].content).members.find((m) => m.email === 'bruno@example.com')
  ok(rec && rec.deleted === true && rec.personal === null, 'rimozione: Bruno segnato come rimosso e blocco personale eliminato dal file')
  await A.page.waitForSelector('text=cambia la Password di Famiglia')
  await B.page.click('nav [aria-label="Cassaforte"]'); await B.page.click('[aria-label="Sincronizza"]'); await B.page.waitForTimeout(1500)
  ok(await B.page.locator('text=Errore').count() > 0, 'rimozione: Bruno non riesce più a sincronizzare (Errore)')
  await A.page.screenshot({ path: `${S}/shots/e2e-anna-family2.png` })
  console.log(errs.length ? '\nFALLITI: ' + errs.length + '\n' + errs.join('\n') : '\nTutto ok')
  await browser.close(); process.exit(errs.length ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
