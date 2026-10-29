import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { lot, printing } from '../test/fixtures'
import { ScanPage } from './ScanPage'

// The camera has its own tests. Here a stand-in keeps the parts the page
// cares about: a Capture button that hands up a frame with the URL in `camera.url`, a Flip checkbox
// with its own state, and a count of how often it mounts. The state and the
// count only survive if the page keeps the camera mounted between cards.
const camera = vi.hoisted(() => ({ mounts: 0, url: 'blob:preview' }))

vi.mock('./CameraCapture', async () => {
  const { useEffect, useState } = await import('react')
  return {
    CameraCapture: function CameraStub({
      onCapture,
    }: {
      onCapture: (image: Blob, previewUrl: string) => void
    }) {
      const [flip, setFlip] = useState(false)
      useEffect(() => {
        camera.mounts += 1
      }, [])
      return (
        <div>
          <label>
            <input
              type="checkbox"
              checked={flip}
              onChange={(event) => setFlip(event.target.checked)}
            />
            Flip image
          </label>
          <button
            type="button"
            onClick={() =>
              onCapture(new Blob(['x'], { type: 'image/jpeg' }), camera.url)
            }
          >
            Capture
          </button>
        </div>
      )
    },
  }
})

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    recognizeCard: vi.fn(),
    autocompleteNames: vi.fn(),
    searchPrintings: vi.fn(),
    inscribe: vi.fn(),
  }
})

import {
  autocompleteNames,
  inscribe,
  recognizeCard,
  searchPrintings,
} from '../api'

const recognizeMock = vi.mocked(recognizeCard)
const autocompleteMock = vi.mocked(autocompleteNames)
const searchMock = vi.mocked(searchPrintings)
const inscribeMock = vi.mocked(inscribe)

const SOL_RING = printing({
  scryfall_id: 'sol-ring-c21',
  name: 'Sol Ring',
  set_code: 'c21',
  set_name: 'Commander 2021',
  collector_number: '263',
})

const READINGS = [
  { name: 'Sol Ring', confidence: 0.91, printing: null },
  { name: 'Lightning Bolt', confidence: 0.42, printing: null },
]

/** Sol Ring read with its corner, so the glass already knows the printing. */
const PINNED_READINGS = [
  { name: 'Sol Ring', confidence: 0.91, printing: SOL_RING },
  { name: 'Lightning Bolt', confidence: 0.42, printing: null },
]

// jsdom has no object URLs. The stub stays for the whole file, because the
// page frees its still on unmount and cleanup unmounts after afterEach runs.
// Vitest gives each test file its own globals, so nothing leaks out.
const revokeObjectURL = vi.fn()
URL.revokeObjectURL = revokeObjectURL

beforeEach(() => {
  camera.mounts = 0
  camera.url = 'blob:preview'
  searchMock.mockResolvedValue({ printings: [SOL_RING], truncated: false })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** Render the page and take a frame, landing on the captured step. */
async function capture() {
  const user = userEvent.setup()
  render(<ScanPage />)
  await user.click(screen.getByRole('button', { name: 'Capture' }))
  return user
}

/** Capture and send the frame, landing on the readings step. */
async function readCard() {
  const user = await capture()
  await user.click(screen.getByRole('button', { name: 'Read the card' }))
  return user
}

describe('ScanPage', () => {
  it('scries a card from capture to inscription and returns to the camera', async () => {
    recognizeMock.mockResolvedValue({ readings: READINGS })
    inscribeMock.mockResolvedValue(
      lot({
        id: 9,
        scryfall_id: 'sol-ring-c21',
        card: {
          name: 'Sol Ring',
          set_code: 'c21',
          set_name: 'Commander 2021',
          collector_number: '263',
          rarity: 'uncommon',
          image_uris: null,
        },
      }),
    )

    render(<ScanPage />)
    expect(
      screen.getByRole('heading', { name: 'Scry a Card' }),
    ).toBeInTheDocument()
    expect(screen.getByText('The Scrying Glass')).toBeInTheDocument()
    // The seal's live region is mounted and empty before anything is said.
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Capture' }))

    // 1. The still stands in for the camera until it is read or retaken.
    expect(screen.getByAltText('The captured frame')).toHaveAttribute(
      'src',
      'blob:preview',
    )
    expect(
      screen.queryByRole('button', { name: 'Capture' }),
    ).not.toBeInTheDocument()

    // 2. Send it to the glass and pick the best reading.
    await user.click(screen.getByRole('button', { name: 'Read the card' }))
    const [image, signal] = recognizeMock.mock.calls[0]
    expect(image).toBeInstanceOf(Blob)
    expect(image.type).toBe('image/jpeg')
    expect(signal).toBeInstanceOf(AbortSignal)
    await user.click(
      await screen.findByRole('button', { name: /Sol Ring.*91%/ }),
    )

    // 3. The printing picker and form are the Inscribe flow's own.
    expect(searchMock).toHaveBeenCalledWith('Sol Ring', expect.any(AbortSignal))
    await user.click(
      await screen.findByRole('button', { name: /Commander 2021/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))
    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith(
        expect.objectContaining({ scryfall_id: 'sol-ring-c21' }),
      ),
    )

    // 4. Back at the camera, with the seal and the session entry.
    expect(
      await screen.findByRole('button', { name: 'Capture' }),
    ).toBeInTheDocument()
    expect(region).toHaveTextContent('Sealed into the catalog')
    expect(region).toHaveTextContent('1× Sol Ring (C21 #263) · nonfoil')
    const session = screen.getByRole('complementary', {
      name: 'Scried this session',
    })
    expect(within(session).getByText(/1× Sol Ring/)).toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('lifts the seal when the next frame is captured', async () => {
    recognizeMock.mockResolvedValue({ readings: READINGS })
    inscribeMock.mockResolvedValue(lot({ id: 4 }))
    const user = await readCard()
    await user.click(await screen.findByRole('button', { name: /Sol Ring/ }))
    await user.click(
      await screen.findByRole('button', { name: /Commander 2021/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))
    expect(await screen.findByText('Sealed into the catalog')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Capture' }))
    expect(
      screen.queryByText('Sealed into the catalog'),
    ).not.toBeInTheDocument()
    // The session list outlives the seal.
    expect(
      screen.getByRole('complementary', { name: 'Scried this session' }),
    ).toBeInTheDocument()
  })

  it('says so when the glass reads no name, and offers both ways on', async () => {
    recognizeMock.mockResolvedValue({ readings: [] })
    await readCard()

    expect(
      await screen.findByText('The glass could not make out a name.'),
    ).toHaveAttribute('role', 'status')
    expect(screen.getByAltText('The captured frame')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Type the name instead' }),
    ).toBeInTheDocument()
  })

  it('shows the backend detail when no engine is fitted and lets the name be typed instead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const detail =
      'No scrying glass is fitted to this scriptorium. Type the name instead.'
    recognizeMock.mockRejectedValue(new ApiError(detail, 503, detail))
    autocompleteMock.mockResolvedValue(['Sol Ring'])
    const user = await readCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(detail)

    await user.click(
      screen.getByRole('button', { name: 'Type the name instead' }),
    )
    const search = screen.getByLabelText('Card name')
    expect(search).toHaveFocus()
    await user.type(search, 'sol')
    await user.click(await screen.findByRole('button', { name: 'Sol Ring' }))

    expect(
      await screen.findByRole('heading', {
        name: /Choose a printing of “Sol Ring”/,
      }),
    ).toBeInTheDocument()

    // Changing the card goes back to typing, not to the failed reading.
    await user.click(screen.getByRole('button', { name: 'Change card' }))
    expect(screen.getByLabelText('Card name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument()
  })

  it('shows the backend detail for an unreadable image and lets the name be typed instead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const detail =
      'The glass could not make sense of that image. Capture the card again.'
    recognizeMock.mockRejectedValue(new ApiError(detail, 400, detail))
    autocompleteMock.mockResolvedValue(['Sol Ring'])
    await readCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(
      screen.getByRole('button', { name: 'Type the name instead' }),
    ).toBeInTheDocument()
  })

  it('returns to the same readings from the picker without reading again', async () => {
    recognizeMock.mockResolvedValue({ readings: READINGS })
    const user = await readCard()
    await user.click(await screen.findByRole('button', { name: /Sol Ring/ }))
    await screen.findByRole('heading', { name: /Choose a printing/ })

    await user.click(screen.getByRole('button', { name: 'Change card' }))

    expect(
      screen.getByRole('button', { name: /Lightning Bolt.*42%/ }),
    ).toBeInTheDocument()
    expect(recognizeMock).toHaveBeenCalledTimes(1)
  })

  it('goes back to the printings of the same card on "Change printing"', async () => {
    recognizeMock.mockResolvedValue({ readings: READINGS })
    const user = await readCard()
    await user.click(await screen.findByRole('button', { name: /Sol Ring/ }))
    await user.click(
      await screen.findByRole('button', { name: /Commander 2021/ }),
    )

    await user.click(screen.getByRole('button', { name: 'Change printing' }))

    expect(
      await screen.findByRole('heading', {
        name: /Choose a printing of “Sol Ring”/,
      }),
    ).toBeInTheDocument()
  })

  it('goes straight to the Inscribe form when the reading names its printing', async () => {
    recognizeMock.mockResolvedValue({ readings: PINNED_READINGS })
    const user = await readCard()

    await user.click(
      await screen.findByRole('button', { name: /Sol Ring.*Commander 2021/ }),
    )

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Sol Ring.*Commander 2021 \(C21\) · #263/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /Choose a printing/ }),
    ).not.toBeInTheDocument()
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('opens the printings of the read card on "Change printing" after the shortcut', async () => {
    recognizeMock.mockResolvedValue({ readings: PINNED_READINGS })
    const user = await readCard()
    await user.click(
      await screen.findByRole('button', { name: /Sol Ring.*Commander 2021/ }),
    )

    await user.click(screen.getByRole('button', { name: 'Change printing' }))

    expect(
      await screen.findByRole('heading', {
        name: /Choose a printing of “Sol Ring”/,
      }),
    ).toBeInTheDocument()
    expect(searchMock).toHaveBeenCalledWith('Sol Ring', expect.any(AbortSignal))
  })

  it('still opens the picker for a reading without a printing', async () => {
    recognizeMock.mockResolvedValue({ readings: PINNED_READINGS })
    const user = await readCard()

    await user.click(
      await screen.findByRole('button', { name: /Lightning Bolt.*42%/ }),
    )

    expect(
      await screen.findByRole('heading', {
        name: /Choose a printing of “Lightning Bolt”/,
      }),
    ).toBeInTheDocument()
    expect(searchMock).toHaveBeenCalledWith(
      'Lightning Bolt',
      expect.any(AbortSignal),
    )
  })

  it('retakes from the captured frame, letting go of the still', async () => {
    const user = await capture()

    await user.click(screen.getByRole('button', { name: 'Retake' }))

    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument()
    expect(screen.queryByAltText('The captured frame')).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    expect(recognizeMock).not.toHaveBeenCalled()
  })

  it('retakes from the readings, letting go of the still', async () => {
    recognizeMock.mockResolvedValue({ readings: READINGS })
    const user = await readCard()
    await screen.findByRole('button', { name: /Sol Ring/ })

    await user.click(screen.getByRole('button', { name: 'Retake' }))

    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('abandons the request when retaking while the card is being read', async () => {
    recognizeMock.mockReturnValue(new Promise(() => {}))
    const user = await readCard()
    expect(screen.getByText('Reading the card…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retake' }))

    const [, signal] = recognizeMock.mock.calls[0]
    expect(signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument()
  })

  it('abandons the request when the page is left mid-read', async () => {
    recognizeMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const { unmount } = render(<ScanPage />)
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await user.click(screen.getByRole('button', { name: 'Read the card' }))

    unmount()

    const [, signal] = recognizeMock.mock.calls[0]
    expect(signal?.aborted).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('falls back to a plain message when the failure has no detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    recognizeMock.mockRejectedValue(new Error('network down'))
    await readCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The card could not be read. Try again.',
    )
  })

  it('keeps the camera open and its flip set from one card to the next', async () => {
    recognizeMock.mockResolvedValue({ readings: READINGS })
    inscribeMock.mockResolvedValue(lot({ id: 5 }))
    const user = userEvent.setup()
    render(<ScanPage />)
    await user.click(screen.getByLabelText('Flip image'))

    // Capture and retake.
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await user.click(screen.getByRole('button', { name: 'Retake' }))
    // Capture, read, and inscribe.
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await user.click(screen.getByRole('button', { name: 'Read the card' }))
    await user.click(await screen.findByRole('button', { name: /Sol Ring/ }))
    await user.click(
      await screen.findByRole('button', { name: /Commander 2021/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))

    expect(
      await screen.findByRole('button', { name: 'Capture' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Flip image')).toBeChecked()
    // One mount means one camera stream for the whole visit.
    expect(camera.mounts).toBe(1)
  })

  it('hides the camera while a captured frame is on show', async () => {
    await capture()

    expect(
      screen.queryByRole('button', { name: 'Capture' }),
    ).not.toBeInTheDocument()
    // Still mounted, so the flip holds, but hidden from sight and from
    // assistive technology. Label queries ignore that, so this asks by role.
    expect(
      screen.queryByRole('checkbox', { name: 'Flip image' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Flip image', hidden: true }),
    ).toBeInTheDocument()
  })

  it('shows the backend detail for a frame over the size limit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const detail =
      'The image is larger than 12 MB. Capture at a lower resolution.'
    recognizeMock.mockRejectedValue(new ApiError(detail, 413, detail))
    await readCard()

    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
  })

  it('frees the previous still when a new frame replaces it', async () => {
    camera.url = 'blob:first'
    await capture()

    // The hidden camera hands up a second frame, as a late capture would.
    camera.url = 'blob:second'
    fireEvent.click(
      screen.getByRole('button', { name: 'Capture', hidden: true }),
    )

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:second')
    expect(screen.getByAltText('The captured frame')).toHaveAttribute(
      'src',
      'blob:second',
    )
  })

  it('stays on the camera when an abandoned request rejects late', async () => {
    let fail: (reason: unknown) => void = () => {}
    recognizeMock.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    const user = await readCard()
    await user.click(screen.getByRole('button', { name: 'Retake' }))

    await act(async () =>
      fail(new DOMException('The request was aborted.', 'AbortError')),
    )

    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stays on the camera when an abandoned request answers late', async () => {
    let answer: (value: { readings: typeof READINGS }) => void = () => {}
    recognizeMock.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const user = await readCard()
    await user.click(screen.getByRole('button', { name: 'Retake' }))

    await act(async () => answer({ readings: READINGS }))

    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Cards the glass read' }),
    ).not.toBeInTheDocument()
  })

  it('still abandons the newer request after an older one settles', async () => {
    let answerFirst: (value: { readings: typeof READINGS }) => void = () => {}
    recognizeMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirst = resolve
        }),
      )
      .mockReturnValueOnce(new Promise(() => {}))
    const user = userEvent.setup()
    const { unmount } = render(<ScanPage />)

    // First card: read, then retake before it answers.
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await user.click(screen.getByRole('button', { name: 'Read the card' }))
    await user.click(screen.getByRole('button', { name: 'Retake' }))
    // Second card: read, and leave it in flight.
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await user.click(screen.getByRole('button', { name: 'Read the card' }))
    // The first request settles; its cleanup must leave the second alone.
    await act(async () => answerFirst({ readings: READINGS }))

    unmount()

    const [, secondSignal] = recognizeMock.mock.calls[1]
    expect(secondSignal?.aborted).toBe(true)
  })
})
