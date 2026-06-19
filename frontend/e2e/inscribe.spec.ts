import { expect, test } from '@playwright/test'
import { stubApi } from './stubs'

// The Inscribe golden path end to end: search a name → pick a printing → set
// acquisition details → inscribe, and see it recorded in the session list. The
// catalog and inventory endpoints are stubbed (see stubs.ts); no real backend.

test('inscribes a card through the full search → pick → inscribe flow', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto('/inscribe')

  // 1. Search the catalog by name; the debounced type-ahead surfaces a match.
  await page.getByLabel('Card name').fill('Sol Ring')
  await page.getByRole('button', { name: 'Sol Ring' }).click()

  // 2. Pick the specific printing (folio) from the catalog's printings list.
  await page.getByRole('button', { name: /Commander 2021/ }).click()

  // 3. The form defaults (nonfoil · NM · qty 1) are fine — inscribe it.
  await expect(
    page.getByRole('heading', { name: /Sol Ring — Commander 2021/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Inscribe' }).click()

  // 4. The session log records the inscription and the flow returns to search.
  const session = page.getByRole('complementary', {
    name: 'Inscribed this session',
  })
  await expect(session).toContainText('Sol Ring')
  await expect(session).toContainText('C21 #263')
  await expect(session).toContainText('nonfoil')
  await expect(page.getByLabel('Card name')).toBeVisible()
})
