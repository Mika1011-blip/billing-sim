import { expect, test } from '@playwright/test'

// Runs against a live stack (docker compose up). No API key needed: the
// generation uses the built-in fallback scenario.
test('generate with the fallback, move the clock to the end, read the client dashboard', async ({ page }) => {
  await page.goto('/dev')

  await page.getByLabel('Demande du client').fill('Un tableau de bord des factures pour une banque')
  await page.getByLabel('Utiliser le scénario de secours').check()
  await page.getByRole('button', { name: 'Générer' }).click()
  await expect(page.locator('pre.output')).toContainText('"plan"', { timeout: 30_000 })

  // Clock to the last day: read it from the API, then set the slider to it.
  const clock = await (await page.request.get('/sim/clock')).json()
  const last = String(clock.last_day)
  await page.getByLabel('Jour', { exact: true }).fill(last)
  await expect(page.locator('.clock-panel p')).toHaveText(new RegExp(`^Jour ${last} / ${last} `))

  // At the end of the run the ledger (Grand livre) shows money received: some invoice has a Payé cell other than 0.
  const paidCells = page.locator('.ledger table').first().locator('tbody tr td:nth-child(6)')
  await expect(paidCells.first()).toBeVisible()
  const paid = await paidCells.allTextContents()
  expect(paid.length).toBeGreaterThan(0)
  expect(paid.some((cell) => cell.trim() !== '0' && cell.trim() !== '0 €')).toBe(true)

  // The shell's nav link takes us to the client page; its clock badge shows the last day.
  await page.getByRole('link', { name: 'Client', exact: true }).click()
  await expect(page).toHaveURL(/\/client$/)
  await expect(page.locator('.clock-badge')).toContainText(`Jour ${last} ·`)
  await expect(page.getByText('Reste à payer').first()).toBeVisible()
  // The invoice cards' status pills carry their day count or payment date: « Très en retard (39 j) », « Payée le … ».
  await expect(page.locator('.invoice-card .pill').filter({ hasText: /^(Très en retard|En retard|Payée) / }).first()).toBeVisible()
})
