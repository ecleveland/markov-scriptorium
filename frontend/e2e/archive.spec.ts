import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The Muniment Room end to end: start with no sealed copies, seal one by
// hand, and see it confirmed and listed. The copies live in the stub (see
// stubs.ts). The export links are checked by href only, never followed.

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

test('seals a copy by hand and lists it', async ({ page }) => {
  await page.goto('/archive')
  await expect(
    page.getByRole('heading', { name: 'The Muniment Room' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'No copies sealed yet' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Seal a copy' }).click()

  // The header's health chip is a status too, so pick the seal by its text.
  await expect(
    page.getByRole('status').filter({ hasText: 'Sealed scriptorium-' }),
  ).toContainText('Sealed scriptorium-20261015T142200Z-v6-manual.db.')
  const table = page.getByRole('table', { name: 'Backups' })
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByRole('row').nth(1)).toContainText('By hand')
  await expect(table.getByRole('row').nth(1)).toContainText('v6')
  await expect(
    page.getByText('Copies rest in /tmp/scriptorium/backups.', {
      exact: false,
    }),
  ).toBeVisible()
})

test('offers the collection as CSV and JSON downloads', async ({ page }) => {
  await page.goto('/archive')

  const csv = page.getByRole('link', { name: 'Export the collection as CSV' })
  await expect(csv).toHaveAttribute('href', '/api/archive/export.csv')
  await expect(csv).toHaveAttribute('download', '')
  const json = page.getByRole('link', { name: 'Export the collection as JSON' })
  await expect(json).toHaveAttribute('href', '/api/archive/export.json')
  await expect(json).toHaveAttribute('download', '')
})
