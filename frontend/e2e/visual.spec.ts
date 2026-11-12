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
  await expect(page.locator('.status[data-state="ok"]')).toBeVisible()

  const shot = await page.screenshot({ fullPage: true })
  expect(shot.byteLength).toBeGreaterThan(0)
})

test('captures the app shell collapsed at a narrow (mobile) width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/inscribe')
  await expect(page.locator('.status[data-state="ok"]')).toBeVisible()

  const shot = await page.screenshot({ fullPage: true })
  expect(shot.byteLength).toBeGreaterThan(0)
})

// The leaf sets a margin column beside the page and drops it on a phone.
test.describe('the leaf', () => {
  test('sets the margin left of a widened Index at 1280px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/index')
    await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
    await expect(
      page.getByText('Three folios, kept in one Volume. No Tomes bound.'),
    ).toBeVisible()

    const margin = page.locator('.leaf__margin')
    await expect(margin).toBeVisible()
    const marginBox = await margin.boundingBox()
    const indexBox = await page.locator('.index').boundingBox()
    expect(marginBox).not.toBeNull()
    expect(indexBox).not.toBeNull()
    expect(marginBox!.x + marginBox!.width).toBeLessThan(indexBox!.x)
    // 66ch of EB Garamond at the 19px root is about 602px, so an Index wider
    // than 684px proves its own sheet widened the leaf.
    expect(indexBox!.width).toBeGreaterThan(684)

    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth)
  })

  // Inscribe keeps the default 66ch measure while the Index and the Catalog
  // set wider ones, so both must come out wider than Inscribe.
  test('widens the Index and the Catalog past Inscribe at 1280px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/inscribe')
    await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Inscribe a Card' }),
    ).toBeVisible()
    const inscribeBox = await page.locator('.inscribe').boundingBox()
    expect(inscribeBox).not.toBeNull()
    expect(inscribeBox!.width).toBeLessThan(700)

    await page.goto('/index')
    await expect(
      page.getByText('Three folios, kept in one Volume. No Tomes bound.'),
    ).toBeVisible()
    const indexBox = await page.locator('.index').boundingBox()
    expect(indexBox).not.toBeNull()
    expect(indexBox!.width).toBeGreaterThan(inscribeBox!.width)

    await page.goto('/catalog')
    await expect(page.getByRole('list', { name: 'Lots' })).toBeVisible()
    const catalogBox = await page.locator('.catalog').boundingBox()
    expect(catalogBox).not.toBeNull()
    expect(catalogBox!.width).toBeGreaterThan(inscribeBox!.width)
  })

  // Below the collapse the page moves to the only column. This guards the
  // column reset inside the 44rem query.
  for (const { path, heading } of [
    { path: '/import/csv', heading: 'Import a Collection CSV' },
    { path: '/archive', heading: 'The Muniment Room' },
  ]) {
    test(`${path} fills the column at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(path)
      await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()

      const widths = await page.locator('main').evaluate((main) => {
        const style = getComputedStyle(main)
        const content =
          main.getBoundingClientRect().width -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)
        const section = main.querySelector(':scope > section')
        return {
          content,
          section: section ? section.getBoundingClientRect().width : 0,
          // Resolved track sizes. Without the column reset the page lands in
          // an implicit second track beside an empty first one.
          tracks: style.gridTemplateColumns.trim().split(/\s+/).length,
        }
      })
      expect(widths.tracks).toBe(1)
      expect(widths.section).toBeGreaterThanOrEqual(widths.content * 0.9)
    })
  }

  // Media queries read rem at 16px, so the 44rem collapse falls at 704px.
  test('hides the margin below the collapse at 700px', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 })
    await page.goto('/index')
    await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'The Index' })).toBeVisible()

    await expect(page.locator('.leaf__margin')).toBeHidden()
  })

  // Between the collapse and 960px the sidebar stacks above the results, so
  // the grid gets the whole column. Beside the sidebar it fitted one tile.
  test('sets two Index tiles side by side at 800px', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/index')
    await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
    const tiles = page
      .getByRole('list', { name: 'Folios' })
      .getByRole('listitem')
    await expect(tiles).toHaveCount(3)

    const first = await tiles.nth(0).boundingBox()
    const second = await tiles.nth(1).boundingBox()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    // Same row, give or take sub-pixel rounding.
    expect(Math.abs(second!.y - first!.y)).toBeLessThan(1)
    expect(second!.x).toBeGreaterThan(first!.x)
  })

  test('keeps the margin above the collapse at 720px', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 })
    await page.goto('/index')
    await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'The Index' })).toBeVisible()

    await expect(page.locator('.leaf__margin')).toBeVisible()
  })
})

// The Index's grid, plate and ledger at a common phone size. The sort keys,
// the seek line and the ledger's columns must all fit without side scroll.
test.describe('the Index at 390px', () => {
  for (const path of ['/index', '/index?view=list']) {
    test(`${path} has no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(path)
      await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
      await expect(
        page.getByText('Three folios, kept in one Volume. No Tomes bound.'),
      ).toBeVisible()
      await expect(
        page.getByRole('region', { name: 'Newest inscription' }),
      ).toBeVisible()
      await expect(
        page.getByRole('list', { name: 'Folios' }).getByRole('listitem'),
      ).toHaveCount(3)

      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth)
    })
  }
})

// The manual 375px sweep made repeatable: each page must fit a phone without
// a horizontal scrollbar. Screenshots land in the test output dir for the PR.
test.describe('reflows at phone width', () => {
  const routes = [
    // The Index and the Catalog render their heading before their entries
    // arrive, so wait for the opening sentence, which waits on the count, or
    // the check measures the narrow loading line instead.
    {
      path: '/index',
      slug: 'index',
      heading: 'The Index',
      text: 'Three folios, kept in one Volume. No Tomes bound.',
    },
    {
      path: '/index/bolt-lea',
      slug: 'index-printing',
      heading: 'Lightning Bolt',
    },
    {
      path: '/catalog',
      slug: 'catalog',
      text: 'Three entries in the Catalog, the newest inscribed first.',
    },
    { path: '/catalog/2', slug: 'catalog-detail', heading: 'Lightning Bolt' },
    { path: '/inscribe', slug: 'inscribe' },
    { path: '/tomes', slug: 'tomes', heading: 'The Tomes' },
    { path: '/import', slug: 'import', heading: 'Bring in a Collection' },
    { path: '/import/decklist', slug: 'import-decklist' },
    { path: '/import/csv', slug: 'import-csv' },
    { path: '/archive', slug: 'archive', heading: 'The Muniment Room' },
  ]

  for (const { path, slug, heading, text } of routes) {
    test(`${path} has no horizontal scroll at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(path)
      await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
      if (heading) {
        await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      }
      if (text) {
        await expect(page.getByText(text)).toBeVisible()
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
    await expect(page.locator('.status[data-state="ok"]')).toBeVisible()
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
