import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// Proves headless screenshot capture works, at desktop and a narrow (mobile)
// width, so presentational tickets (the rest of M3.7) can attach before/after
// evidence. This is NOT pixel visual-regression — there is no committed
// baseline to diff against; that is deliberately out of scope (see the ticket).

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('captures a full-page screenshot of the app shell at desktop width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/inscribe')
  await expect(page.locator('.status')).toContainText(/catalog ok/i)

  const shot = await page.screenshot({ fullPage: true })
  expect(shot.byteLength).toBeGreaterThan(0)
})

test('captures the app shell collapsed at a narrow (mobile) width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/inscribe')
  await expect(page.locator('.status')).toContainText(/catalog ok/i)

  const shot = await page.screenshot({ fullPage: true })
  expect(shot.byteLength).toBeGreaterThan(0)
})
