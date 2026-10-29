import { expect, test, type Page } from '@playwright/test'
import { stubApi } from './stubs'

// The Scrying Glass end to end against Chromium's fake camera (see the launch
// flags in playwright.config.ts): capture a frame of its test pattern, let the
// stubbed scanner read it, then settle the folio and inscribe it.

test.beforeEach(async ({ context, page }) => {
  // The fake UI flag already grants Chromium the camera; grant it anyway so
  // the spec does not lean on a flag alone.
  await context.grantPermissions(['camera'])
  await stubApi(page)
})

/** Wait until the camera has painted a frame there is to draw. */
async function waitForFrame(page: Page) {
  // HAVE_CURRENT_DATA (2) or better.
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2)
}

/** Whether the camera's video track is sending frames rather than resting. */
async function trackEnabled(page: Page) {
  return page
    .locator('video')
    .evaluate(
      (video: HTMLVideoElement) =>
        (video.srcObject as MediaStream).getVideoTracks()[0].enabled,
    )
}

/**
 * Check the card guide lies inside the video's picture, wherever
 * `object-fit: contain` puts it. A card lined up to a guide that spills onto
 * the letterbox has its title bar outside the captured frame.
 */
async function expectGuideInsidePicture(page: Page) {
  const fit = await page.locator('.camera').evaluate((camera) => {
    const video = camera.querySelector('video') as HTMLVideoElement
    const guide = camera.querySelector('.camera__guide') as HTMLElement
    const box = video.getBoundingClientRect()
    const scale = Math.min(
      box.width / video.videoWidth,
      box.height / video.videoHeight,
    )
    const width = video.videoWidth * scale
    const height = video.videoHeight * scale
    const left = box.left + (box.width - width) / 2
    const top = box.top + (box.height - height) / 2
    const rect = guide.getBoundingClientRect()
    // A pixel of slack for subpixel rounding.
    return (
      rect.left >= left - 1 &&
      rect.top >= top - 1 &&
      rect.right <= left + width + 1 &&
      rect.bottom <= top + height + 1
    )
  })
  expect(fit, 'the card guide lies inside the video picture').toBe(true)
}

/** Open the page and wait for the fake camera's first frame. */
async function openGlass(page: Page) {
  await page.goto('/scan')
  await expect(page.getByRole('heading', { name: 'Scry a Card' })).toBeVisible()
  await waitForFrame(page)
}

test('scries a card from the camera into the catalog', async ({ page }) => {
  await openGlass(page)
  await expectGuideInsidePicture(page)
  expect(await trackEnabled(page)).toBe(true)

  await page.getByRole('button', { name: 'Capture' }).click()
  await expect(page.getByAltText('The captured frame')).toBeVisible()
  // The camera rests while the still is on show.
  await expect.poll(() => trackEnabled(page)).toBe(false)

  const sent = page.waitForRequest('**/api/scanner/recognize')
  await page.getByRole('button', { name: 'Read the card' }).click()
  // The canvas really encoded the fake camera's frame as a JPEG.
  const request = await sent
  expect(request.headers()['content-type']).toBe('image/jpeg')
  const body = request.postDataBuffer()
  expect(body?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))

  // The reading names its printing, so the glass goes straight to the form.
  await page.getByRole('button', { name: /Sol Ring.*91%/ }).click()
  await expect(
    page.getByRole('heading', { level: 2, name: /Sol Ring.*Commander 2021/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /Choose a printing/ }),
  ).toHaveCount(0)

  // The picker is still a click away.
  await page.getByRole('button', { name: 'Change printing' }).click()
  await expect(
    page.getByRole('heading', { name: /Choose a printing of “Sol Ring”/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Commander 2021/ }).click()
  await page.getByRole('button', { name: 'Inscribe' }).click()

  // Found by text, not by role: the header's status chip is a status too.
  await expect(page.getByText('Sealed into the catalog')).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Scried this session' }),
  ).toContainText('Sol Ring')
  // Back at the camera for the next card. It stayed open, rested, while
  // hidden, so the next frame comes without asking for the camera again.
  await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible()
  await expect.poll(() => trackEnabled(page)).toBe(true)
  await waitForFrame(page)
  await page.getByRole('button', { name: 'Capture' }).click()
  await expect(page.getByAltText('The captured frame')).toBeVisible()
})

test('offers to type the name when the glass reads nothing', async ({
  page,
}) => {
  // Registered after stubApi, so Playwright tries it first.
  await page.route('**/api/scanner/recognize', (route) =>
    route.fulfill({ json: { readings: [] } }),
  )
  await openGlass(page)

  await page.getByRole('button', { name: 'Capture' }).click()
  await page.getByRole('button', { name: 'Read the card' }).click()
  await expect(
    page.getByText('The glass could not make out a name.'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Type the name instead' }).click()
  await page.getByLabel('Card name').fill('Sol Ring')
  await page.getByRole('button', { name: 'Sol Ring' }).click()
  await expect(
    page.getByRole('heading', { name: /Choose a printing of “Sol Ring”/ }),
  ).toBeVisible()
})
