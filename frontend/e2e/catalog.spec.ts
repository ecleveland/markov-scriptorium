import { expect, test, type Page } from '@playwright/test'
import { stubApi } from './stubs'

// The Catalog end to end: browse what is owned as a ledger, adjust a quantity
// in place, page through a long collection, open a folio, amend it, and
// remove it. The inventory endpoints are stubbed with mutable state (see
// stubs.ts); no real backend.

/** The ledger's entries, one per lot on the page. */
function entries(page: Page) {
  return page.getByRole('list', { name: 'Lots' }).getByRole('listitem')
}

/** The Alpha Bolt's entry, found by its where line. */
function alphaBolt(page: Page) {
  return entries(page).filter({ hasText: 'Limited Edition Alpha, no. 161.' })
}

test('browses the collection and adjusts a quantity in place', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/catalog')

  await expect(page.getByRole('heading', { name: 'The Catalog' })).toBeVisible()
  await expect(
    page.getByText('Three entries in the Catalog, the newest inscribed first.'),
  ).toBeVisible()
  await expect(entries(page)).toHaveCount(3)
  await expect(page.getByRole('link', { name: 'Sol Ring' })).toBeVisible()
  await expect(
    entries(page).filter({ hasText: 'Sol Ring' }).locator('.ledger__where'),
  ).toContainText('Red binder')

  // The Alpha Bolt starts at 2 copies; step it up without leaving the list.
  // The entry's own rubric number is 2 as well, so read the stepper's figure.
  const bolt = alphaBolt(page)
  await expect(bolt.locator('.qty-stepper__value')).toHaveText('2')
  await bolt
    .getByRole('button', { name: 'Increase quantity of Lightning Bolt' })
    .click()
  await expect(bolt.locator('.qty-stepper__value')).toHaveText('3')
})

test('pages through a long collection as a numbered ledger', async ({
  page,
}) => {
  await stubApi(page, { extraLots: 30 })
  await page.goto('/catalog')

  await expect(
    page.getByText(
      'Thirty-three entries in the Catalog, the newest inscribed first.',
    ),
  ).toBeVisible()
  await expect(entries(page)).toHaveCount(25)
  await expect(page.locator('.ledger__number').first()).toHaveText('1')
  await expect(
    page.getByRole('button', { name: 'Newer entries' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: 'Older entries' }).click()

  await expect(page).toHaveURL(/\/catalog\?page=2$/)
  await expect(page.locator('.ledger__number').first()).toHaveText('26')
  await expect(entries(page)).toHaveCount(8)
  await expect(
    page.getByRole('button', { name: 'Older entries' }),
  ).toBeDisabled()
})

test('opens a folio, reads its ownership across printings, and amends it', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/catalog')

  await alphaBolt(page).getByRole('link', { name: 'Lightning Bolt' }).click()

  await expect(page).toHaveURL(/\/catalog\/2$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lightning Bolt' }),
  ).toBeVisible()
  await expect(
    page.getByText('Limited Edition Alpha, no. 161, common.'),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'Amend the entry' }),
  ).toBeVisible()

  // Two printings are owned, so the summary counts the whole card, not the folio.
  const ownership = page.getByRole('complementary', {
    name: 'Ownership across printings',
  })
  await expect(ownership).toContainText(
    'You own 6 copies of Lightning Bolt across 2 printings.',
  )
  await expect(ownership).toContainText('4× Double Masters 2022')

  await page.getByLabel('Condition').selectOption('LP')
  await page.getByLabel('Volume').fill('Long box')
  await page.getByRole('button', { name: 'Amend' }).click()
  // Scoped by text, not by role: the header's live status chip is a status too.
  await expect(page.getByText('Amended.')).toBeVisible()

  // The amendment is what the Catalog shows on the way back.
  await page.getByRole('link', { name: 'Back to the Catalog' }).click()
  const bolt = alphaBolt(page)
  await expect(bolt).toContainText('lightly played')
  await expect(bolt).toContainText('Long box')
})

test('removes a folio only after confirming, then returns to the Catalog', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/catalog/2')

  await page.getByRole('button', { name: 'Remove from the collection' }).click()
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(
    page.getByRole('button', { name: 'Remove from the collection' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Remove from the collection' }).click()
  await page.getByRole('button', { name: 'Confirm removal' }).click()

  await expect(page).toHaveURL(/\/catalog$/)
  await expect(
    page.getByText('Two entries in the Catalog, the newest inscribed first.'),
  ).toBeVisible()
  await expect(alphaBolt(page)).toHaveCount(0)
})
