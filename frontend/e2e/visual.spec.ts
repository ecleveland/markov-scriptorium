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

// The manual 375px sweep made repeatable: each page must fit a phone without
// a horizontal scrollbar. Screenshots land in the test output dir for the PR.
test.describe('reflows at phone width', () => {
  const routes = [
    // The table arrives on its own fetch after the status chip, so wait for it
    // or the check measures the narrow loading line instead.
    { path: '/catalog', slug: 'catalog', table: true },
    { path: '/catalog/2', slug: 'catalog-detail', heading: 'Lightning Bolt' },
    { path: '/inscribe', slug: 'inscribe' },
    { path: '/import/decklist', slug: 'import-decklist' },
    { path: '/import/csv', slug: 'import-csv' },
  ]

  for (const { path, slug, heading, table } of routes) {
    test(`${path} has no horizontal scroll at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(path)
      await expect(page.locator('.status')).toContainText(/catalog ok/i)
      if (heading) {
        await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      }
      if (table) {
        await expect(page.getByRole('table')).toBeVisible()
      }

      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      )
      expect(fits).toBe(true)

      await page.screenshot({
        path: test.info().outputPath(`${slug}-375.png`),
        fullPage: true,
      })
    })
  }
})
