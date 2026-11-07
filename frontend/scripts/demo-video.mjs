// Records the demo video of the simulation against a running stack (docker compose up).
// Run from frontend/:  node scripts/demo-video.mjs   → ../docs/demo/demo.webm + timeline.json
// Deterministic: fallback scenario, seed 42. French captions are injected into the page.
// Each scene lasts at least its narration file (docs/demo/voice/narration-fr-0N.mp3, durations below) so the
// voice-over can be placed at the scene's start time: see docs/demo/mux.sh.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:5173'
const API = process.env.DEMO_API_URL ?? 'http://localhost:8000'
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'demo')
fs.mkdirSync(outDir, { recursive: true })
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.webm')) fs.unlinkSync(path.join(outDir, f))

// Narration file lengths in seconds (docs/demo/voice/narration-fr-0N.mp3, one per scene) + a breath.
const SEGMENTS = [9.98, 15.46, 12.20, 11.15, 11.18, 7.16, 8.18, 11.18, 6.87]
const BREATH = 0.6

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
  locale: 'fr-FR',
})
const page = await context.newPage()
const t0 = Date.now() // the recording starts with the page
const timeline = []
let sceneStart = 0
function scene(n) {
  sceneStart = Date.now()
  timeline.push({ scene: n, start: (sceneStart - t0) / 1000 })
}
/** Holds the picture until the scene has lasted its narration segment. */
async function sceneEnd(n) {
  const minMs = (SEGMENTS[n - 1] + BREATH) * 1000
  const left = minMs - (Date.now() - sceneStart)
  if (left > 0) await page.waitForTimeout(left)
}

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
const toTop = async () => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await pause(500) }

/** Moves the client page's clock through its own date picker so the UI reacts at once. */
async function clientGoTo(isoDate) {
  const input = page.getByLabel('Choisir une date')
  await input.fill(isoDate)
  await input.press('Enter')
  await page.getByRole('heading', { level: 1 }).filter({ hasText: /jour \d+/ }).waitFor()
  await pause(900)
}

// Working-day index → date for the default start (Monday 2026-03-02): 12 → 03-18, 20 → 03-30, 45 → 05-04, 75 → 06-15.
const DAY12 = '2026-03-18', DAY20 = '2026-03-30', DAY45 = '2026-05-04', LAST = '2026-06-15'

// ---------------------------------------------------------------- scène 1 : la demande
scene(1)
await page.request.post(`${API}/sim/reset`)
await page.goto(`${BASE}/dev`)
await pause(800)
await caption("Le client décrit son besoin ; l'équipe propose les lots, les tickets et un prix fixe.", 1500)
await slowType(page.getByLabel('Demande du client'), 'Un portail de suivi des factures pour une banque, avec export comptable et alertes de retard.')
await page.getByLabel('Graine').fill('42')
await page.getByLabel('Utiliser le scénario de secours').check()
await pause(500)
await page.getByRole('button', { name: 'Générer' }).click()
await page.locator('pre.output').waitFor({ state: 'visible', timeout: 30_000 })
await pause(1200)
await sceneEnd(1)

// ---------------------------------------------------------------- scène 2 : le planning
scene(2)
await caption('Chaque ticket a une taille ; le prix = jours × TJM. Le planning est fixé à la signature.', 2500)
await smoothScroll(page.locator('.gantt').first())
await pause(2500)
await smoothScroll(page.locator('.ledger').first())
await pause(2000)
await sceneEnd(2)

// ---------------------------------------------------------------- scène 3 : la réalité diverge
scene(3)
await smoothScroll(page.locator('.clock-panel'))
await caption('La réalité diverge : blocages, dépassements… le prix ne bouge pas.', 1500)
for (const d of [4, 8, 12]) {
  const day = page.getByLabel('Jour', { exact: true })
  await day.fill(String(d))
  await day.press('Enter')
  await pause(1300)
}
await smoothScroll(page.locator('.gantt').first())
await pause(1500)
await sceneEnd(3)

// ---------------------------------------------------------------- scène 4 : le client suit le travail (jour 12)
scene(4)
await page.getByRole('link', { name: 'Client', exact: true }).click()
await page.getByRole('heading', { level: 1 }).waitFor()
await pause(800)
await caption('Le client suit, jour par jour, ce qui est réellement fait.', 2000)
const chronoTab = page.getByRole('tab', { name: 'Chronologie' })
const hasChrono = (await chronoTab.count()) > 0
if (hasChrono) {
  // Final cut: the Chronologie view (planned vs real up to today, Terminé / Reste à faire, ticket detail).
  await chronoTab.click()
  await page.getByRole('tabpanel').waitFor()
  await pause(600)
  await smoothScroll(page.getByRole('tabpanel'))
  await pause(1800)
  const doneRow = page.getByRole('tabpanel').locator('.ticket-row').first()
  await doneRow.click()
  await page.getByRole('tabpanel').locator('.ticket-body').first().waitFor({ state: 'visible' })
  await pause(400)
  await smoothScroll(page.getByRole('tabpanel').locator('.ticket-body').first())
  await caption('Étapes prévues cochées, journal du travail, jours réels contre jours facturés.', 3000)
  await sceneEnd(4)
  await toTop()
  await page.getByRole('tab', { name: 'Factures' }).click()
  await pause(500)
} else {
  await smoothScroll(page.locator('.lots-en-cours'))
  const firstLot = page.locator('.lot-card').first()
  await firstLot.getByRole('button', { name: 'Afficher les tickets' }).click()
  await firstLot.locator('.ticket-row').first().waitFor({ state: 'visible' })
  await pause(900)
  await firstLot.locator('.ticket-row').first().click()
  await firstLot.locator('.ticket-body').first().waitFor({ state: 'visible' })
  await pause(400)
  await smoothScroll(firstLot.locator('.ticket-body').first())
  await caption('Étapes prévues cochées, journal du travail, jours réels contre jours facturés.', 3000)
  await sceneEnd(4)
}

// ---------------------------------------------------------------- scène 5 : la facture (jour 45)
scene(5)
await toTop()
await clientGoTo(DAY45)
await caption("À la livraison du lot, une facture : chaque ligne est justifiée.", 2000)
await smoothScroll(page.locator('.invoice-grid'))
await pause(1200)
const firstCard = page.locator('.invoice-card').first()
await firstCard.locator('.invoice-card-title').click()
const drawer = page.getByRole('dialog')
const hasDrawer = await drawer.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)
if (hasDrawer) {
  await caption('Résumé de la livraison, tickets couverts, calcul HT → TVA → TTC.', 2500)
  await drawer.locator('.ticket-row').first().click().catch(() => {})
  await pause(1800)
  await drawer.getByText(/Total TTC|TTC/).last().scrollIntoViewIfNeeded().catch(() => {})
  await caption("Jours facturés contre jours réels : l'écart est absorbé par le prestataire.", 2500)
  await sceneEnd(5)
  await page.keyboard.press('Escape')
  await pause(500)
} else {
  await sceneEnd(5)
}

// ---------------------------------------------------------------- scène 6 : payer
scene(6)
await caption('Le client règle ; le tableau de bord se met à jour.', 1500)
await smoothScroll(firstCard)
await firstCard.getByRole('button', { name: 'Marquer comme payée' }).click()
await firstCard.getByText(/Payée le/).waitFor({ timeout: 10_000 })
await pause(1200)
await toTop()
await pause(1500)
await sceneEnd(6)

// ---------------------------------------------------------------- scène 7 : le dernier jour
scene(7)
await clientGoTo(LAST)
await caption("Ce qui n'est pas payé finit en retard — rien n'est caché.", 2500)
await smoothScroll(page.locator('.invoice-grid'))
await pause(1500)
await sceneEnd(7)

// ---------------------------------------------------------------- scène 8 : l'assistant
scene(8)
await toTop()
await caption("L'assistant répond avec les mêmes chiffres, et cite ses sources.", 1500)
const ask = page.getByPlaceholder(/Posez une question/)
await slowType(ask, 'Pourquoi le lot L2 coûte ce prix, et est-il payé ?')
await page.getByRole('button', { name: 'Envoyer' }).click()
const citation = page.locator('.assistant a[href^="#"]').first()
await citation.waitFor({ timeout: 60_000 }).catch(() => {})
await pause(3000)
if (await citation.count()) {
  await citation.click()
  await pause(2500)
  if (hasDrawer && (await page.getByRole('dialog').count())) await page.keyboard.press('Escape')
}
await sceneEnd(8)

// ---------------------------------------------------------------- scène 9 : remonter le temps
scene(9)
await caption("Remonter le temps rejoue l'histoire ; rien n'est inventé.", 1500)
await clientGoTo(DAY20)
await smoothScroll(page.locator('.invoice-grid'))
await sceneEnd(9)

await hideCaption()
await pause(1000)
const total = (Date.now() - t0) / 1000
await context.close()
await browser.close()
const video = fs.readdirSync(outDir).find((f) => f.endsWith('.webm'))
fs.renameSync(path.join(outDir, video), path.join(outDir, 'demo.webm'))
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ total, scenes: timeline }, null, 2))
console.log('wrote', path.join(outDir, 'demo.webm'), 'timeline:', timeline.map((s) => `${s.scene}@${s.start.toFixed(1)}s`).join(' '))
