// Records the demo video of the simulation against a running stack (docker compose up).
// Run from frontend/:  node scripts/demo-video.mjs   → ../docs/demo/demo.webm
// Deterministic: fallback scenario, seed 42. French captions are injected into the page.
// Convert: docker run --rm -v "<repo>/docs/demo:/work" jrottenberg/ffmpeg:6.1-alpine \
//   -y -i /work/demo.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart /work/demo.mp4
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:5173'
const API = process.env.DEMO_API_URL ?? 'http://localhost:8000'
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'demo')
fs.mkdirSync(outDir, { recursive: true })
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.webm')) fs.unlinkSync(path.join(outDir, f))

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
  locale: 'fr-FR',
})
const page = await context.newPage()

/** Caption banner at the bottom of the page (re-created after each navigation). */
async function caption(text, ms = 3500) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-caption')
    if (!el) {
      el = document.createElement('div')
      el.id = 'demo-caption'
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
        maxWidth: '920px', padding: '12px 22px', borderRadius: '12px',
        background: 'rgba(17,24,39,.9)', color: '#fff', font: '600 20px/1.35 Inter, "Segoe UI", system-ui, sans-serif',
        boxShadow: '0 6px 24px rgba(0,0,0,.35)', zIndex: 99999, textAlign: 'center', transition: 'opacity .3s',
      })
      document.body.appendChild(el)
    }
    el.textContent = t
    el.style.opacity = '1'
  }, text)
  await page.waitForTimeout(ms)
}
const hideCaption = () => page.evaluate(() => { const el = document.getElementById('demo-caption'); if (el) el.style.opacity = '0' })
const pause = (ms) => page.waitForTimeout(ms)
const slowType = (locator, text) => locator.pressSequentially(text, { delay: 30 })
const smoothScroll = async (locator) => { await locator.scrollIntoViewIfNeeded(); await pause(600) }

/** Moves the client page's clock through its own date picker so the UI reacts at once. */
async function clientGoTo(isoDate) {
  const input = page.getByLabel('Choisir une date')
  await input.fill(isoDate)
  await input.press('Enter')
  await page.getByRole('heading', { level: 1 }).filter({ hasText: /jour \d+/ }).waitFor()
  await pause(900)
}

// Working-day index → date for the default start (Monday 2026-03-02): 12 → 03-18, 20 → 03-30, 45 → 05-04, last (75) → 06-15.
const DAY12 = '2026-03-18', DAY20 = '2026-03-30', DAY45 = '2026-05-04'

// ---------------------------------------------------------------- scène 1 : la demande
await page.request.post(`${API}/sim/reset`)
await page.goto(`${BASE}/dev`)
await pause(800)
await caption("Le client décrit son besoin ; l'équipe propose les lots, les tickets et un prix fixe.", 2200)
await slowType(page.getByLabel('Demande du client'), 'Un portail de suivi des factures pour une banque, avec export comptable et alertes de retard.')
await page.getByLabel('Graine').fill('42')
await page.getByLabel('Utiliser le scénario de secours').check()
await pause(500)
await page.getByRole('button', { name: 'Générer' }).click()
await page.locator('pre.output').waitFor({ state: 'visible', timeout: 30_000 })
await pause(1200)

// ---------------------------------------------------------------- scène 2 : le planning
await caption('Chaque ticket a une taille ; le prix = jours × TJM. Le planning est fixé à la signature.', 2500)
await smoothScroll(page.locator('.gantt').first())
await pause(2000)

// ---------------------------------------------------------------- scène 3 : la réalité diverge
await caption('La réalité diverge : blocages, dépassements… le prix ne bouge pas.', 2000)
for (const d of [4, 8, 12]) {
  const day = page.getByLabel('Jour', { exact: true })
  await day.fill(String(d))
  await day.press('Enter')
  await pause(1100)
}
await pause(1200)

// ---------------------------------------------------------------- scène 4 : le client suit le travail (jour 12)
await page.getByRole('link', { name: 'Client', exact: true }).click()
await page.getByRole('heading', { level: 1 }).waitFor()
await pause(800)
await caption('Le client suit, jour par jour, ce qui est réellement fait.', 2500)
await smoothScroll(page.locator('.lots-en-cours'))
const firstLot = page.locator('.lot-card').first()
await firstLot.getByRole('button', { name: 'Afficher les tickets' }).click()
await firstLot.locator('.ticket-row').first().waitFor({ state: 'visible' })
await pause(900)
await firstLot.locator('.ticket-row').first().click()
await firstLot.locator('.ticket-body').first().waitFor({ state: 'visible' })
await pause(400)
await smoothScroll(firstLot.locator('.ticket-body').first())
await caption('Étapes prévues cochées, journal du travail, jours réels contre jours facturés.', 3800)

// ---------------------------------------------------------------- scène 5 : la facture (jour 45)
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await pause(500)
await clientGoTo(DAY45)
await caption("À la livraison du lot, une facture : chaque ligne est justifiée.", 2500)
await smoothScroll(page.locator('.invoice-grid'))
await pause(1500)
const firstCard = page.locator('.invoice-card').first()
await firstCard.locator('.invoice-card-title').click()
const drawer = page.getByRole('dialog')
const hasDrawer = await drawer.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)
if (hasDrawer) {
  await caption('Résumé de la livraison, tickets couverts, calcul HT → TVA → TTC.', 3000)
  await drawer.locator('.ticket-row').first().click().catch(() => {})
  await pause(2200)
  await caption("Jours facturés contre jours réels : l'écart est absorbé par le prestataire.", 3000)
  await page.keyboard.press('Escape')
  await pause(600)
}

// ---------------------------------------------------------------- scène 6 : payer
await caption('Le client règle ; le tableau de bord se met à jour.', 1800)
await smoothScroll(firstCard)
await firstCard.getByRole('button', { name: 'Marquer comme payée' }).click()
await firstCard.getByText(/Payée le/).waitFor({ timeout: 10_000 })
await pause(1200)
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await pause(1800)

// ---------------------------------------------------------------- scène 7 : le dernier jour
const lastDay = (await (await page.request.get(`${API}/sim/clock`)).json()).last_day
await page.getByLabel('Choisir une date').fill('2026-06-15')
await page.getByLabel('Choisir une date').press('Enter')
await page.getByRole('heading', { level: 1 }).filter({ hasText: `jour ${lastDay}` }).waitFor().catch(() => {})
await pause(900)
await caption("Ce qui n'est pas payé finit en retard — rien n'est caché.", 3000)
await smoothScroll(page.locator('.invoice-grid'))
await pause(1800)

// ---------------------------------------------------------------- scène 8 : l'assistant
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await pause(400)
await caption("L'assistant répond avec les mêmes chiffres, et cite ses sources.", 2000)
const ask = page.getByPlaceholder(/Posez une question/)
await slowType(ask, 'Pourquoi le lot L2 coûte ce prix, et est-il payé ?')
await page.getByRole('button', { name: 'Envoyer' }).click()
const citation = page.locator('.assistant a[href^="#"]').first()
await citation.waitFor({ timeout: 60_000 }).catch(() => {})
await pause(4000)
if (await citation.count()) {
  await citation.click()
  await pause(2500)
  if (hasDrawer && (await page.getByRole('dialog').count())) await page.keyboard.press('Escape')
}

// ---------------------------------------------------------------- scène 9 : remonter le temps
await caption("Remonter le temps rejoue l'histoire ; rien n'est inventé.", 1800)
await clientGoTo(DAY20)
await smoothScroll(page.locator('.invoice-grid'))
await pause(2500)

await hideCaption()
await pause(800)
await context.close()
await browser.close()
const video = fs.readdirSync(outDir).find((f) => f.endsWith('.webm'))
fs.renameSync(path.join(outDir, video), path.join(outDir, 'demo.webm'))
console.log('wrote', path.join(outDir, 'demo.webm'))
