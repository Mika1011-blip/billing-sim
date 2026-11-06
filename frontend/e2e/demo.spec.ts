import { expect, test } from '@playwright/test'

// Runs against a live stack (docker compose up). No API key needed: the
// generation uses the built-in fallback scenario.
test('generate with the fallback, move the clock to the end, read the client dashboard', async ({ page }) => {
  await page.goto('/dev')

  await page.getByLabel('Client request').fill('Un tableau de bord des factures pour une banque')
  await page.getByLabel('Use fallback').check()
  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.locator('pre.output')).toContainText('"plan"', { timeout: 30_000 })

  // Clock to the maximum: press +5 until the day stops changing.
  const dayText = page.locator('.clock-panel p')
  await expect(dayText).toContainText('Day ')
  const forward = page.getByRole('button', { name: '+5' })
  let previous = ''
  for (let i = 0; i < 100; i++) {
    const current = (await dayText.textContent()) ?? ''
    if (current === previous) break
    previous = current
    await forward.click()
    await page.waitForTimeout(150)
  }
  const [, day, last] = /Day (\d+) \/ (\d+)/.exec(previous) ?? []
  expect(day).toBe(last)

  await page.goto('/client')
  await expect(page.getByText('Reste à payer').first()).toBeVisible()
  await expect(page.locator('.pill').filter({ hasText: /^(En retard|Payée)$/ }).first()).toBeVisible()
})
