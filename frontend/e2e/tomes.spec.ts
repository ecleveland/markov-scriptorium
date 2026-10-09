import { expect, test, type Page } from '@playwright/test'
import { stubApi } from './stubs'

// The Tomes end to end: bind a Tome, add a commander and a main-deck card,
// step a quantity, read the owned-versus-needed breakdown, remove a card, and
// unbind the Tome. Decks, slots, and lots live in the stub (see stubs.ts); the
// stub owns two Alpha Bolts and four foil Double Masters Bolts.

test.beforeEach(async ({ page }) => {
  await stubApi(page)
})

/** Search a name, pick its one printing, and set the board on the slot form. */
async function addCard(
  page: Page,
  query: string,
  name: string,
  printing: RegExp,
  board: string,
) {
  await page.getByLabel('Card name').fill(query)
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: printing }).click()
  await page.getByLabel('Board').selectOption({ label: board })
  await page.getByRole('button', { name: 'Add to the Tome' }).click()
}

test('binds a Tome, fills it, reads the breakdown, and unbinds it', async ({
  page,
}) => {
  await page.goto('/catalog')
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Tomes' })
    .click()

  await expect(page.getByRole('heading', { name: 'The Tomes' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'No Tomes bound yet' }),
  ).toBeVisible()

  await page.getByLabel('Name').fill("Edgar's Court")
  await page.getByLabel('Format').fill('commander')
  await page.getByRole('button', { name: 'Bind the Tome' }).click()

  await expect(page).toHaveURL(/\/tomes\/1$/)
  await expect(
    page.getByRole('heading', { level: 1, name: "Edgar's Court" }),
  ).toBeVisible()

  await addCard(page, 'sol', 'Sol Ring', /Commander 2021/, 'Commander')
  await expect(page.getByText('Added 1× Sol Ring to Commander.')).toBeVisible()

  await addCard(page, 'bolt', 'Lightning Bolt', /Limited Edition Alpha/, 'Main')
  await expect(page.getByText('Added 1× Lightning Bolt to Main.')).toBeVisible()

  await expect(
    page.getByRole('region', { name: 'Commander · 1' }),
  ).toContainText('Sol Ring')
  // The commander holds one copy, so it gets no stepper.
  await expect(
    page.getByRole('button', { name: 'Increase quantity of Sol Ring' }),
  ).toHaveCount(0)

  const increase = page.getByRole('button', {
    name: 'Increase quantity of Lightning Bolt',
  })
  for (const next of [2, 3, 4]) {
    await increase.click()
    await expect(
      page.getByRole('region', { name: `Main · ${next}` }),
    ).toBeVisible()
  }

  await page.getByRole('link', { name: 'Owned and needed' }).click()
  await expect(page).toHaveURL(/\/tomes\/1\/breakdown$/)
  await expect(page.getByText('5 cards, 3 in hand, 2 needed')).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Commander · 1' }).getByText('in hand'),
  ).toBeVisible()
  const main = page.getByRole('region', { name: 'Main · 4' })
  await expect(main.getByText('2 needed')).toBeVisible()
  await expect(main.getByRole('note')).toContainText(
    'Double Masters 2022 (2X2) · #117',
  )

  await page.getByRole('link', { name: 'Back to the Tome' }).click()
  await page.getByRole('button', { name: 'Remove Lightning Bolt' }).click()
  await expect(page.getByRole('region', { name: /^Main/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Unbind this Tome' }).click()
  await page.getByRole('button', { name: 'Confirm unbinding' }).click()
  await expect(page).toHaveURL(/\/tomes$/)
  await expect(
    page.getByRole('heading', { name: 'No Tomes bound yet' }),
  ).toBeVisible()
})

test('sorts the card list by mana value and keeps it in the URL', async ({
  page,
}) => {
  await page.goto('/tomes')
  await page.getByLabel('Name').fill('Brew')
  await page.getByRole('button', { name: 'Bind the Tome' }).click()
  await expect(page).toHaveURL(/\/tomes\/1$/)

  await addCard(page, 'sol', 'Sol Ring', /Commander 2021/, 'Main')
  await expect(page.getByText('Added 1× Sol Ring to Main.')).toBeVisible()

  await page.getByLabel('Sort by').selectOption('cmc')
  await expect(page).toHaveURL(/\/tomes\/1\?sort=cmc$/)
  await page.reload()
  await expect(page.getByLabel('Sort by')).toHaveValue('cmc')
})

test('the editor and the breakdown fit a phone', async ({ page }) => {
  await page.goto('/tomes')
  await page.getByLabel('Name').fill('Brew')
  await page.getByRole('button', { name: 'Bind the Tome' }).click()
  await addCard(page, 'bolt', 'Lightning Bolt', /Limited Edition Alpha/, 'Main')
  await page
    .getByRole('button', { name: 'Increase quantity of Lightning Bolt' })
    .click()
  await expect(page.getByRole('region', { name: 'Main · 2' })).toBeVisible()

  await page.setViewportSize({ width: 375, height: 812 })
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
  expect(await fits()).toBe(true)

  await page.getByRole('link', { name: 'Owned and needed' }).click()
  await expect(page.getByText('2 cards, 2 in hand, 0 needed')).toBeVisible()
  expect(await fits()).toBe(true)
})
