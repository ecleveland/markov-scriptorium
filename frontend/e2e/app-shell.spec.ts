import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The app shell: brand mark, primary nav, and the live catalog-status chip.
// Selectors are intentionally loose (substring name / `.status` class) so this
// survives the VEG-422 header restyle without churn.

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('renders the brand mark, nav, and a healthy status chip', async ({
  page,
}) => {
  await page.goto('/')

  // Brand mark links home (matches both the old <h1> and the VEG-422 wordmark).
  await expect(
    page.getByRole('link', { name: /The Markov Scriptorium/ }),
  ).toBeVisible()

  await expect(page.getByRole('link', { name: 'Inscribe' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Decklist' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'CSV' })).toBeVisible()

  // Health probe is stubbed ok → the status chip reports the catalog is up.
  await expect(page.locator('.status')).toContainText(/catalog ok/i)
})

test('navigates between the onboarding views via the nav', async ({ page }) => {
  await page.goto('/')

  // Root redirects to Inscribe.
  await expect(
    page.getByRole('heading', { name: 'Inscribe a Card' }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Decklist' }).click()
  await expect(page).toHaveURL(/\/import\/decklist$/)
  await expect(
    page.getByRole('heading', { name: 'Inscribe a Decklist' }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'CSV' }).click()
  await expect(page).toHaveURL(/\/import\/csv$/)
  await expect(
    page.getByRole('heading', { name: 'Import a Collection CSV' }),
  ).toBeVisible()

  // The brand mark returns home.
  await page.getByRole('link', { name: /The Markov Scriptorium/ }).click()
  await expect(page).toHaveURL(/\/inscribe$/)
  await expect(
    page.getByRole('heading', { name: 'Inscribe a Card' }),
  ).toBeVisible()
})
