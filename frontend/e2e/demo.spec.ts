import { expect, test } from '@playwright/test'

// Runs against a live stack (docker compose up). No API key needed: the
// generation uses the built-in fallback scenario.
test('generate with the fallback, move the clock to the end, pay an overdue invoice, open its detail', async ({ page }) => {
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

  // Payments are participant actions: before any, every Payé cell of the ledger (Grand livre) is 0.
  const paidCells = page.locator('.ledger table').first().locator('tbody tr td:nth-child(6)')
  await expect(paidCells.first()).toBeVisible()
  const paid = await paidCells.allTextContents()
  expect(paid.length).toBeGreaterThan(0)
  expect(paid.every((cell) => cell.trim() === '0')).toBe(true)

  // The shell's nav link takes us to the client page; its clock badge shows the last day.
  await page.getByRole('link', { name: 'Client', exact: true }).click()
  await expect(page).toHaveURL(/\/client$/)
  await expect(page.locator('.clock-badge')).toContainText(`Jour ${last} ·`)
  await expect(page.getByText('Reste à payer').first()).toBeVisible()

  // Nothing is paid at the end of the run: at least two invoices are more than 30 days late.
  const veryLate = page.locator('.invoice-card').filter({ hasText: 'Très en retard' })
  await expect(veryLate.nth(1)).toBeVisible()
  expect(await veryLate.count()).toBeGreaterThanOrEqual(2)

  const lateCount = page
    .locator('.tile')
    .filter({ has: page.locator('.tile-label span', { hasText: /^En retard$/ }) })
    .locator('.tile-sub')
  const countOf = (text: string) => Number(/\d+/.exec(text)?.[0])
  const lateBefore = countOf(await lateCount.innerText())
  expect(lateBefore).toBeGreaterThanOrEqual(2)

  // Pay the first very late invoice from its card: it becomes « Payée le … » and the En retard count drops by one.
  const cardId = await veryLate.first().getAttribute('id')
  const card = page.locator(`[id="${cardId}"]`)
  const amount = (await card.locator('.invoice-card-amount').innerText()).replace(/\s*TTC\s*$/, '').trim()
  await card.getByRole('button', { name: 'Marquer comme payée' }).click()
  await expect(card.locator('.pill')).toHaveText(/^Payée le \d{2}\/\d{2}\/\d{4}$/)
  await expect(card.getByRole('button', { name: 'Marquer comme payée' })).toHaveCount(0)
  await expect(lateCount).toHaveText(new RegExp(`^${lateBefore - 1} facture`))

  // Its detail: a dialog whose Total TTC is the card amount; Escape closes it and clears the hash.
  await card.locator('.invoice-card-title').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#facture-${cardId?.replace(/^rec-/, '')}$`))
  await expect(dialog.locator('.calc-ttc strong')).toHaveText(amount)
  await expect(dialog.getByText(/^Payée le \d{2}\/\d{2}\/\d{4} \(réf\. VIR-/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/client$/)
  await expect(card.locator('.invoice-card-title')).toBeFocused()

  // The Chronologie tab: on the last day every ticket is done; a chart row opens its detail with its journal.
  const tickets: { cle: string; journal_nombre: number }[] = await (await page.request.get('/client/tickets')).json()
  expect(tickets.length).toBeGreaterThan(0)
  await page.getByRole('tab', { name: 'Chronologie' }).click()
  await expect(page.getByRole('tab', { name: 'Chronologie' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('list', { name: 'Synthèse' })).toBeVisible() // the tiles stay
  await expect(page.getByRole('heading', { name: `Terminé (${tickets.length})` })).toBeVisible()
  await expect(page.getByRole('region', { name: /^Terminé/ }).locator('.ticket-detail')).toHaveCount(tickets.length)
  await expect(page.getByRole('heading', { name: 'Reste à faire (0)' })).toBeVisible()
  const chart = page.getByRole('group', { name: /^Avancement des tickets/ })
  await expect(chart.locator('rect.real')).toHaveCount(tickets.length)
  const picked = tickets[0]
  await chart.getByRole('button', { name: new RegExp(`^${picked.cle} · `) }).click()
  const detail = page.getByRole('region', { name: 'Détail du ticket' })
  await expect(detail.getByRole('button', { name: new RegExp(`^${picked.cle} `) })).toHaveAttribute('aria-expanded', 'true')
  await expect(detail.getByRole('heading', { name: 'Journal' })).toBeVisible()
  await expect(detail.locator('.journal li')).toHaveCount(picked.journal_nombre)

  // Opening and closing the drawer left no history entry behind: one Back leaves the client page.
  await page.goBack()
  await expect(page).toHaveURL(/\/dev$/)
})
