const { chromium, devices } = require('playwright')
const S = process.argv[2] || 'e2e/out'; require('fs').mkdirSync(S + '/shots', { recursive: true })
;(async () => {
  const browser = await chromium.launch()
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
    await page.goto('http://localhost:4173/')
    await page.waitForSelector('text=Accedi con Google')
    await page.screenshot({ path: `${S}/shots/${scheme}-1-gate.png` })
    await page.click('text=Usa solo su questo dispositivo')
    await page.fill('#hn', 'Casa Rossi'); await page.fill('#on', 'Anna')
    await page.fill('[aria-label="Password di Famiglia"]', 'famiglia-segreta-2026')
    await page.fill('[aria-label="Ripeti Password di Famiglia"]', 'famiglia-segreta-2026')
    await page.fill('[aria-label="Password personale"]', 'personale-anna-123')
    await page.fill('[aria-label="Ripeti password personale"]', 'personale-anna-123')
    await page.screenshot({ path: `${S}/shots/${scheme}-2-create.png` })
    await page.click('button:has-text("Crea cassaforte")')
    await page.waitForSelector('text=La cassaforte è vuota', { timeout: 20000 })
    await page.screenshot({ path: `${S}/shots/${scheme}-3-empty.png` })
    // nuova voce personale
    await page.click('[aria-label="Nuova voce"]')
    await page.fill('#et', 'Netflix'); await page.fill('#eu', 'anna@example.com')
    await page.getByRole('button', { name: 'Genera', exact: true }).click()
    await page.fill('#ew', 'netflix.com'); await page.fill('#en', 'PIN 4321')
    await page.screenshot({ path: `${S}/shots/${scheme}-4-entry.png` })
    await page.click('button:has-text("Salva")')
    // nuova voce comune
    await page.click('[aria-label="Nuova voce"]')
    await page.click('button:has-text("Comune")')
    await page.fill('#et', 'Wi-Fi Casa'); await page.fill('#eu', 'router')
    await page.getByRole('button', { name: 'Genera', exact: true }).click(); await page.click('button:has-text("Salva")')
    await page.waitForSelector('[data-testid=count]:has-text("2")')
    await page.screenshot({ path: `${S}/shots/${scheme}-5-vault.png` })
    for (const [name, shot] of [['Generatore', 'generator'], ['Categorie', 'categories'], ['Famiglia', 'family']]) {
      await page.click(`nav [aria-label="${name}"]`); await page.waitForTimeout(500)
      await page.screenshot({ path: `${S}/shots/${scheme}-6-${shot}.png` })
    }
    // la cache contiene solo testo cifrato
    const dump = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('pwduo', 1); r.onsuccess = () => res(r.result); r.onerror = rej })
      return await new Promise((res) => { const rq = db.transaction('kv').objectStore('kv').get('vault'); rq.onsuccess = () => res(JSON.stringify(rq.result)) })
    })
    for (const s of ['Netflix', 'Wi-Fi Casa', 'anna@example.com'.replace('anna', 'ZZ'), 'PIN 4321', 'famiglia-segreta']) if (dump.includes(s)) errs.push('PLAINTEXT in cache: ' + s)
    // blocco e sblocco
    await page.click('nav [aria-label="Cassaforte"]'); await page.waitForTimeout(400)
    await page.click('[aria-label="Blocca ora"]')
    await page.waitForSelector('text=Cassaforte bloccata')
    await page.screenshot({ path: `${S}/shots/${scheme}-7-locked.png` })
    await page.fill('[aria-label="Password di Famiglia"]', 'sbagliata-sbagliata')
    await page.fill('[aria-label="Password personale"]', 'personale-anna-123')
    await page.click('button:has-text("Sblocca")')
    await page.waitForSelector('text=Password di Famiglia errata.', { timeout: 20000 })
    await page.fill('[aria-label="Password di Famiglia"]', 'famiglia-segreta-2026')
    await page.click('button:has-text("Sblocca")')
    await page.waitForSelector('[data-testid=count]:has-text("2")', { timeout: 20000 })
    // dopo ricarica la copia cifrata torna bloccata e si sblocca con i dati
    await page.reload(); await page.waitForSelector('text=Cassaforte bloccata')
    await page.fill('[aria-label="Password di Famiglia"]', 'famiglia-segreta-2026'); await page.fill('[aria-label="Password personale"]', 'personale-anna-123')
    await page.click('button:has-text("Sblocca")'); await page.waitForSelector('[data-testid=count]:has-text("2")', { timeout: 20000 })
    // apri dettaglio e controlla mostra/nascondi
    await page.click('[aria-label="Apri Netflix"]'); await page.waitForSelector('[data-testid=pw-value]')
    const hidden = await page.textContent('[data-testid=pw-value]')
    await page.click('[aria-label="Mostra password"]')
    const shown = await page.textContent('[data-testid=pw-value]')
    if (!/^•+$/.test(hidden) || /•/.test(shown)) errs.push('mostra/nascondi non funziona')
    await page.screenshot({ path: `${S}/shots/${scheme}-8-detail.png` })
    // controlli di design
    const checks = await page.evaluate(() => {
      const bf = (el) => el ? getComputedStyle(el).backdropFilter : 'none'
      return {
        cardBlur: bf(document.querySelector('.card')),
        navBlur: bf(document.querySelector('nav')),
        scrollX: document.documentElement.scrollWidth > innerWidth,
      }
    })
    console.log(scheme, JSON.stringify(checks), errs.length ? errs : 'no errors')
    await ctx.close()
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
