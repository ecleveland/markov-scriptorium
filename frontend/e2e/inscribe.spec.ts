import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The Inscribe golden path end to end: search a name, pick a printing, set
// acquisition details, inscribe, and see it recorded in the session list. The
// catalog and inventory endpoints are stubbed (see stubs.ts); no real backend.

test('inscribes a card through the full search, pick and inscribe flow', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/inscribe')

  // 1. Search the catalog by name; the debounced type-ahead surfaces a match.
  await page.getByLabel('Seek a card by name, or part of one').fill('Sol Ring')
  await page.getByRole('button', { name: 'Sol Ring' }).click()

  // 2. Pick the specific printing (folio) from the catalog's printings list.
  await page.getByRole('button', { name: /Commander 2021/ }).click()

  // 3. The form defaults (nonfoil, NM, quantity 1) are fine, so inscribe it.
  // The plate names the card and sets the printing on the line beneath.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Sol Ring' }),
  ).toBeVisible()
  await expect(
    page.getByText('Commander 2021, no. 263', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Inscribe' }).click()

  // Found by text, not by role: the header's status chip is a status too.
  await expect(page.getByText('Sealed into the catalog')).toBeVisible()
  await expect(page.locator('.sealed')).toContainText('Sol Ring')

  // 4. The session log records the inscription and the flow returns to search.
  const session = page.getByRole('complementary', {
    name: 'Inscribed this session',
  })
  await expect(session).toContainText('Sol Ring')
  await expect(session).toContainText('C21 no. 263')
  await expect(session).toContainText('nonfoil')
  await expect(
    page.getByLabel('Seek a card by name, or part of one'),
  ).toBeVisible()
})
