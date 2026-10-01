import { expect, test } from '@playwright/test'
import { SOL_RING_PRINTING, stubApi } from './stubs'

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

      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth)

      await page.screenshot({
        path: test.info().outputPath(`${slug}-375.png`),
        fullPage: true,
      })
    })
  }

  // The first step of each route fits, but the preview one step later holds
  // text the page does not control: a raw CSV row with no break opportunity,
  // and the longest real card name. Both once pushed the page sideways.
  test('/import/decklist preview has no horizontal scroll at 375px', async ({
    page,
  }) => {
    const longName = 'Asmoranomardicadaistinaculdacar'
    const csvRow =
      'Lightning Bolt,LEA,Limited Edition Alpha,161,normal,common,1,1234,e3285e6b-3e79-4d7c-bf96-d920f973b80d,0.5,false,false,near_mint,en,USD'
    const candidate = (id: string, set: string, setName: string) => ({
      ...SOL_RING_PRINTING,
      scryfall_id: id,
      name: longName,
      set_code: set,
      set_name: setName,
    })
    await page.route('**/api/onboarding/parse', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [
            {
              line_number: 2,
              name: longName,
              quantity: 4,
              set_code: null,
              collector_number: null,
            },
          ],
          problems: [{ line_number: 1, reason: 'unreadable', text: csvRow }],
        }),
      }),
    )
    await page.route('**/api/onboarding/resolve', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              input: {
                name: longName,
                set_code: null,
                collector_number: null,
                quantity: 4,
                finish: null,
                condition: null,
                language: null,
              },
              status: 'ambiguous',
              match: null,
              candidates: [
                candidate('asmor-mh2', 'mh2', 'Modern Horizons 2'),
                candidate('asmor-pmh2', 'pmh2', 'Modern Horizons 2 Promos'),
              ],
            },
          ],
          summary: { matched: 0, ambiguous: 1, unmatched: 0 },
        }),
      }),
    )

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/import/decklist')
    await expect(page.locator('.status')).toContainText(/catalog ok/i)
    await page
      .getByRole('textbox', { name: 'Decklist' })
      .fill(`${csvRow}\n4 ${longName}`)
    await page.getByRole('button', { name: 'Resolve decklist' }).click()
    await expect(
      page.getByRole('heading', { name: 'Review the Decklist' }),
    ).toBeVisible()

    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth)
    // The long name spills out of its row's content box into the padding,
    // inside the page gutter, so the page-wide check alone misses it. Measure
    // the widest child of the row against the room the row gives it.
    const row = await page.locator('.decklist__row').evaluate((el) => {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const contentRight =
        box.right -
        parseFloat(style.borderRightWidth) -
        parseFloat(style.paddingRight)
      const childRight = Math.max(
        ...[...el.children].map((child) => child.getBoundingClientRect().right),
      )
      return { childRight, contentRight }
    })
    expect(row.childRight).toBeLessThanOrEqual(row.contentRight)

    await page.screenshot({
      path: test.info().outputPath('import-decklist-preview-375.png'),
      fullPage: true,
    })
  })
})
