import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The Index end to end: browse the collection from the root, narrow it with a
// facet and a name search, switch views, then open a printing and follow it on
// to a lot. The search and facets are stubbed from the same mutable lots the
// Catalog specs use (see stubs.ts); no real backend.

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('browses from the root, then narrows by finish and by name', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/index$/)
  await expect(page.getByRole('heading', { name: 'The Index' })).toBeVisible()
  await expect(page.getByText('Showing 1 to 3 of 3 folios')).toBeVisible()
  const tiles = page.getByRole('list', { name: 'Folios' }).getByRole('listitem')
  await expect(tiles).toHaveCount(3)

  // Only the Double Masters Bolt is foil. The box is controlled by the URL,
  // which React Router updates inside a transition, so click() and assert on
  // the URL rather than check(), which reads the box before that commit.
  const foil = page.getByRole('checkbox', { name: 'foil', exact: true })
  await foil.click()
  await expect(page).toHaveURL(/\/index\?finish=foil$/)
  await expect(foil).toBeChecked()
  await expect(page.getByText('Showing 1 to 1 of 1 folio')).toBeVisible()
  await expect(tiles).toHaveCount(1)
  await expect(tiles).toContainText('Double Masters 2022 (2X2) · #117')

  await foil.click()
  await expect(page).toHaveURL(/\/index$/)
  await expect(foil).not.toBeChecked()
  await expect(tiles).toHaveCount(3)

  await page.getByLabel('Search the Index').fill('sol')
  await expect(page).toHaveURL(/\/index\?name=sol$/)
  await expect(tiles).toHaveCount(1)
  await expect(tiles.getByRole('link', { name: 'Sol Ring' })).toBeVisible()
  await expect(tiles).toContainText('Red binder')
})

test('switches to the list view and back', async ({ page }) => {
  await page.goto('/index')

  await page.getByRole('button', { name: 'List' }).click()
  await expect(page).toHaveURL(/\/index\?view=list$/)
  const table = page.getByRole('region', { name: 'Index table' })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(page.getByRole('list', { name: 'Folios' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Grid' }).click()
  await expect(page).toHaveURL(/\/index$/)
  await expect(
    page.getByRole('list', { name: 'Folios' }).getByRole('listitem'),
  ).toHaveCount(3)
})

test('opens a printing, follows a lot, and comes back to the filtered Index', async ({
  page,
}) => {
  await page.goto('/index?finish=foil')

  await page.getByRole('link', { name: 'Lightning Bolt' }).click()
  await expect(page).toHaveURL(/\/index\/bolt-2x2$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lightning Bolt' }),
  ).toBeVisible()
  await expect(
    page.getByText('Double Masters 2022 · 2X2 #117 · uncommon'),
  ).toBeVisible()
  await expect(page.getByText('4 owned · 0 in Tomes · 4 free')).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Ownership across printings' }),
  ).toContainText('You own 6 copies of Lightning Bolt across 2 printings.')

  // The printing's lots are Catalog rows, so each opens its lot.
  await page
    .getByRole('region', { name: 'Lots of this printing' })
    .getByRole('link', { name: 'Lightning Bolt' })
    .click()
  await expect(page).toHaveURL(/\/catalog\/3$/)

  await page.goBack()
  await page.getByRole('link', { name: 'Back to the Index' }).click()
  await expect(page).toHaveURL(/\/index\?finish=foil$/)
  await expect(
    page.getByRole('checkbox', { name: 'foil', exact: true }),
  ).toBeChecked()
})
