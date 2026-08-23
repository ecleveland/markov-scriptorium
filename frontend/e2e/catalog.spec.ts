import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The Catalog end to end: browse what is owned, adjust a quantity in place,
// open a folio, amend it, and remove it. The inventory endpoints are stubbed
// with mutable state (see stubs.ts); no real backend.

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('browses the collection and adjusts a quantity in place', async ({
  page,
}) => {
  await page.goto('/catalog')

  await expect(page.getByRole('heading', { name: 'The Catalog' })).toBeVisible()
  await expect(page.getByText('Showing 1 to 3 of 3 folios')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sol Ring' })).toBeVisible()
  await expect(page.getByText('Red binder')).toBeVisible()

  // The Alpha Bolt row starts at 2 copies; step it up without leaving the list.
  const row = page.getByRole('row').filter({ hasText: 'LEA #161' })
  await expect(row).toContainText('2')
  await row
    .getByRole('button', { name: 'Increase quantity of Lightning Bolt' })
    .click()
  await expect(row).toContainText('3')
})

test('opens a folio, reads its ownership across printings, and amends it', async ({
  page,
}) => {
  await page.goto('/catalog')

  await page
    .getByRole('row')
    .filter({ hasText: 'LEA #161' })
    .getByRole('link', { name: 'Lightning Bolt' })
    .click()

  await expect(page).toHaveURL(/\/catalog\/2$/)
  await expect(
    page.getByRole('heading', { name: 'Lightning Bolt' }),
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
  const row = page.getByRole('row').filter({ hasText: 'LEA #161' })
  await expect(row).toContainText('LP')
  await expect(row).toContainText('Long box')
})

test('removes a folio only after confirming, then returns to the Catalog', async ({
  page,
}) => {
  await page.goto('/catalog/2')

  await page.getByRole('button', { name: 'Remove from the collection' }).click()
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(
    page.getByRole('button', { name: 'Remove from the collection' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Remove from the collection' }).click()
  await page.getByRole('button', { name: 'Confirm removal' }).click()

  await expect(page).toHaveURL(/\/catalog$/)
  await expect(page.getByText('Showing 1 to 2 of 2 folios')).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: 'LEA #161' }),
  ).toHaveCount(0)
})
