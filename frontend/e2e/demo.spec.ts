import { expect, test } from '@playwright/test'

// Runs against a live stack (docker compose up). No API key needed: the
// generation uses the built-in fallback scenario.
test('generate with the fallback, move the clock to the end, read the client dashboard', async ({ page }) => {
  await page.goto('/dev')

  await page.getByLabel('Client request').fill('Un tableau de bord des factures pour une banque')
  await page.getByLabel('Use fallback').check()
  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.locator('pre.output')).toContainText('"plan"', { timeout: 30_000 })

  // Clock to the last day: read it from the API, then set the slider to it.
  const clock = await (await page.request.get('/sim/clock')).json()
  const last = String(clock.last_day)
  await page.getByLabel('Day', { exact: true }).fill(last)
  await expect(page.locator('.clock-panel p')).toHaveText(new RegExp(`^Day ${last} / ${last} `))

  await page.goto('/client')
  await expect(page.getByText('Reste à payer').first()).toBeVisible()
  await expect(page.locator('.pill').filter({ hasText: /^(En retard|Payée)$/ }).first()).toBeVisible()
})
