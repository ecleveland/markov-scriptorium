import { expect, test, type Page } from '@playwright/test'
import { stubApi } from './stubs'

// The Index end to end: browse the collection from the root, narrow it with a
// facet and a name search, switch views, page the ledger, then open a printing
// and follow it on to a lot. The search and facets are stubbed from the same
// mutable lots the Catalog specs use (see stubs.ts); no real backend. Each
// test calls stubApi itself, once, because the paging test needs more lots.

/** The results, by the name both the grid and the ledger carry. */
function folios(page: Page) {
  return page.getByRole('list', { name: 'Folios' }).getByRole('listitem')
}

function plate(page: Page) {
  return page.getByRole('region', { name: 'Newest inscription' })
}

test('browses from the root, then narrows by finish and by name', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/')

  await expect(page).toHaveURL(/\/index$/)
  await expect(page.getByRole('heading', { name: 'The Index' })).toBeVisible()
  // Three seeded lots, each its own folio. Only the Sol Ring is shelved, and
  // GET /decks starts empty.
  await expect(page.locator('.index__opening')).toHaveText(
    'Three folios. One Volume on the shelf. No Tomes bound.',
  )
  const tiles = folios(page)
  await expect(tiles).toHaveCount(3)

  // The newest lot is the highest id: the Double Masters Bolt, foil.
  await expect(plate(page).getByRole('heading', { level: 2 })).toHaveText(
    'Lightning Bolt foil',
  )
  await expect(
    plate(page).getByText('Double Masters 2022, no. 117, uncommon.'),
  ).toBeVisible()
  await expect(
    plate(page).getByText(
      'Four copies, near mint, unshelved. Not yet claimed by any Tome.',
    ),
  ).toBeVisible()
  await expect(
    plate(page).getByRole('link', { name: 'Shelve it in a Volume' }),
  ).toHaveAttribute('href', '/catalog/3')
  await expect(
    plate(page).getByRole('link', { name: 'Open the folio' }),
  ).toHaveAttribute('href', '/index/bolt-2x2')

  // Only the Double Masters Bolt is foil. The box is controlled by the URL,
  // which React Router updates inside a transition, so click() and assert on
  // the URL rather than check(), which reads the box before that commit.
  const foil = page.getByRole('checkbox', { name: 'foil', exact: true })
  await foil.click()
  await expect(page).toHaveURL(/\/index\?finish=foil$/)
  await expect(foil).toBeChecked()
  await expect(page.locator('.index__opening')).toHaveText(
    'One folio matches these filters.',
  )
  await expect(plate(page)).toHaveCount(0)
  await expect(tiles).toHaveCount(1)
  await expect(tiles).toContainText('Double Masters 2022, no. 117. Unshelved.')

  await foil.click()
  await expect(page).toHaveURL(/\/index$/)
  await expect(foil).not.toBeChecked()
  await expect(tiles).toHaveCount(3)
  await expect(plate(page)).toBeVisible()

  await page.getByLabel('Seek a card by name, or part of one').fill('sol')
  await expect(page).toHaveURL(/\/index\?name=sol$/)
  await expect(page.locator('.index__opening')).toHaveText(
    "One folio matches 'sol'.",
  )
  await expect(plate(page)).toHaveCount(0)
  await expect(tiles).toHaveCount(1)
  await expect(tiles.getByRole('link', { name: 'Sol Ring' })).toBeVisible()
  await expect(tiles).toContainText('Red binder')
})

test('switches to the list view and back', async ({ page }) => {
  await stubApi(page)
  await page.goto('/index')
  await expect(folios(page)).toHaveCount(3)
  await expect(page.locator('ol.ledger')).toHaveCount(0)

  await page.getByRole('button', { name: 'List' }).click()
  await expect(page).toHaveURL(/\/index\?view=list$/)
  await expect(page.locator('ol.ledger')).toHaveCount(1)
  await expect(folios(page)).toHaveCount(3)
  await expect(page.locator('.ledger__number').first()).toHaveText('1')
  await expect(
    folios(page).filter({ hasText: 'Commander 2021, no. 263. Red binder.' }),
  ).toHaveCount(1)

  await page.getByRole('button', { name: 'Grid' }).click()
  await expect(page).toHaveURL(/\/index$/)
  await expect(page.locator('ol.ledger')).toHaveCount(0)
  await expect(folios(page)).toHaveCount(3)
})

test('pages the ledger, numbering on from one page to the next', async ({
  page,
}) => {
  await stubApi(page, { extraLots: 30 })
  await page.goto('/index?view=list')

  await expect(page.locator('.index__opening')).toHaveText(
    'Thirty-three folios. One Volume on the shelf. No Tomes bound.',
  )
  await expect(folios(page)).toHaveCount(24)
  await expect(page.locator('.ledger__number').first()).toHaveText('1')
  await expect(
    page.getByRole('button', { name: 'Earlier folios' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: 'Later folios' }).click()
  await expect(page).toHaveURL(/\/index\?view=list&page=2$/)
  await expect(page.locator('.ledger__number').first()).toHaveText('25')
  await expect(folios(page)).toHaveCount(9)
  await expect(
    page.getByRole('button', { name: 'Later folios' }),
  ).toBeDisabled()
  // The plate opens page one only.
  await expect(plate(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Earlier folios' }).click()
  await expect(page).toHaveURL(/\/index\?view=list$/)
  await expect(page.locator('.ledger__number').first()).toHaveText('1')
})

test('opens a printing, follows a lot, and comes back to the filtered Index', async ({
  page,
}) => {
  await stubApi(page)
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

  await page.getByRole('link', { name: 'Back to the printing' }).click()
  await expect(page).toHaveURL(/\/index\/bolt-2x2$/)
  await page.getByRole('link', { name: 'Back to the Index' }).click()
  await expect(page).toHaveURL(/\/index\?finish=foil$/)
  await expect(
    page.getByRole('checkbox', { name: 'foil', exact: true }),
  ).toBeChecked()
})
