// Renders docs/simulation-facturation.html to docs/simulation-facturation.pdf with the Playwright
// Chromium the e2e tests use.  Run from frontend/:  node scripts/build-doc-pdf.mjs
import { chromium } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs')
const html = path.join(docs, 'simulation-facturation.html')
const out = path.join(docs, 'simulation-facturation.pdf')

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(pathToFileURL(html).href, { waitUntil: 'load' })
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log('wrote', out)
