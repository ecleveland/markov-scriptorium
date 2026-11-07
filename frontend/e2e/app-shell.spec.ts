import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The running head: brand mark, primary nav, and the catalog's status
// sentence. Nav locators are scoped to the nav and exact, because getByRole
// substring-matches names and "The Catalog" also names a heading.

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('renders the brand mark, nav, and the open catalog', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('link', { name: /The Markov Scriptorium/ }),
  ).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Primary' })
  for (const name of [
    'The Index',
    'The Catalog',
    'Tomes',
    'Inscribe',
    'Scry',
    'Bring in',
    'Muniment Room',
  ]) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  }

  // The health probe is stubbed ok, so the sentence says the catalog is open.
  const status = page.locator('.status[data-state="ok"]')
  await expect(status).toBeVisible()
  await expect(status).toContainText('the catalog is open')
})

test('navigates between the views via the nav', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  const main = page.getByRole('main')

  // Root redirects to the Index, the collection's home.
  await expect(page).toHaveURL(/\/index$/)
  await expect(page.getByRole('heading', { name: 'The Index' })).toBeVisible()

  await nav.getByRole('link', { name: 'The Catalog', exact: true }).click()
  await expect(page).toHaveURL(/\/catalog$/)
  await expect(page.getByRole('heading', { name: 'The Catalog' })).toBeVisible()

  await nav.getByRole('link', { name: 'Inscribe', exact: true }).click()
  await expect(page).toHaveURL(/\/inscribe$/)
  await expect(
    page.getByRole('heading', { name: 'Inscribe a Card' }),
  ).toBeVisible()

  await nav.getByRole('link', { name: 'Scry', exact: true }).click()
  await expect(page).toHaveURL(/\/scan$/)
  await expect(page.getByRole('heading', { name: 'Scry a Card' })).toBeVisible()

  await nav.getByRole('link', { name: 'Bring in', exact: true }).click()
  await expect(page).toHaveURL(/\/import$/)
  await expect(
    page.getByRole('heading', { name: 'Bring in a Collection' }),
  ).toBeVisible()

  await main
    .getByRole('link', { name: 'Inscribe a Decklist', exact: true })
    .click()
  await expect(page).toHaveURL(/\/import\/decklist$/)
  await expect(
    page.getByRole('heading', { name: 'Inscribe a Decklist' }),
  ).toBeVisible()

  await nav.getByRole('link', { name: 'Bring in', exact: true }).click()
  await expect(page).toHaveURL(/\/import$/)
  await main
    .getByRole('link', { name: 'Import a Collection CSV', exact: true })
    .click()
  await expect(page).toHaveURL(/\/import\/csv$/)
  await expect(
    page.getByRole('heading', { name: 'Import a Collection CSV' }),
  ).toBeVisible()

  await nav.getByRole('link', { name: 'Muniment Room', exact: true }).click()
  await expect(page).toHaveURL(/\/archive$/)
  await expect(
    page.getByRole('heading', { name: 'The Muniment Room' }),
  ).toBeVisible()

  // The brand mark returns home.
  await page.getByRole('link', { name: /The Markov Scriptorium/ }).click()
  await expect(page).toHaveURL(/\/index$/)
  await expect(page.getByRole('heading', { name: 'The Index' })).toBeVisible()
})
