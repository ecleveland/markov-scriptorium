import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { NewestPlate } from './NewestPlate'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, listInventory: vi.fn() }
})

import { ApiError, listInventory, type InventoryLot } from '../api'

const listMock = vi.mocked(listInventory)

function newest(...results: InventoryLot[]) {
  return { results, total: results.length, limit: 1, offset: 0 }
}

/** Where a link went, and the state it carried there. */
function Arrived() {
  const { pathname, state } = useLocation()
  return (
    <output aria-label="Arrived">
      {pathname} {JSON.stringify(state)}
    </output>
  )
}

function renderPlate(entry = '/index') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/index" element={<NewestPlate />} />
        <Route path="*" element={<Arrived />} />
      </Routes>
    </MemoryRouter>,
  )
}

const CROWN = lot({
  id: 7,
  scryfall_id: 'edgar-voc',
  quantity: 1,
  finish: 'foil',
  condition: 'NM',
  location: null,
  card: {
    name: 'Edgar, Charmed Groom',
    set_code: 'vow',
    set_name: 'Innistrad: Crimson Vow',
    collector_number: '320',
    rarity: 'mythic',
    image_uris: null,
  },
  folio: { owned: 1, reserved: 0, available: 1 },
})

afterEach(() => vi.clearAllMocks())

describe('NewestPlate', () => {
  it('asks for the one newest lot', async () => {
    listMock.mockResolvedValue(newest(CROWN))
    renderPlate()
    await screen.findByRole('region', { name: 'Newest inscription' })
    expect(listMock).toHaveBeenCalledWith(0, 1)
  })

  it('names the lot with its finish and says what and where it is', async () => {
    listMock.mockResolvedValue(newest(CROWN))
    renderPlate()

    const plate = within(
      await screen.findByRole('region', { name: 'Newest inscription' }),
    )
    const heading = plate.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Edgar, Charmed Groom foil')
    expect(plate.getByText('foil')).toHaveClass('finish-word')
    expect(
      plate.getByText('Innistrad: Crimson Vow, no. 320, mythic.'),
    ).toHaveClass('plate__printing')
    expect(
      plate.getByText(
        'One copy, near mint, unshelved. Not yet claimed by any Tome.',
      ),
    ).toBeInTheDocument()
    expect(
      plate.getByRole('img', {
        name: 'Edgar, Charmed Groom (no image in the catalog)',
      }),
    ).toHaveClass('card-thumb--full')
  })

  it('says nothing about a nonfoil finish', async () => {
    listMock.mockResolvedValue(newest(lot({ finish: 'nonfoil' })))
    renderPlate()
    const heading = await screen.findByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Lightning Bolt')
  })

  it('names the Volume and the Tome claim of a shelved, claimed lot', async () => {
    listMock.mockResolvedValue(
      newest(
        lot({
          quantity: 3,
          condition: 'LP',
          location: 'Red binder',
          folio: { owned: 4, reserved: 2, available: 2 },
        }),
      ),
    )
    renderPlate()
    expect(
      await screen.findByText(
        "Three copies, lightly played, in Red binder. Two of the folio's four copies are claimed by Tomes.",
      ),
    ).toBeInTheDocument()
  })

  it('sends an unshelved lot to its page to be shelved, returning to the Index', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue(newest(CROWN))
    renderPlate()

    const shelve = await screen.findByRole('link', {
      name: 'Shelve it in a Volume',
    })
    expect(shelve).toHaveAttribute('href', '/catalog/7')
    expect(shelve).toHaveClass('btn', 'btn--primary')
    await user.click(shelve)
    expect(screen.getByRole('status', { name: 'Arrived' })).toHaveTextContent(
      '/catalog/7 {"back":{"to":"/index","label":"Back to the Index"}}',
    )
  })

  it('offers to move a shelved lot instead', async () => {
    listMock.mockResolvedValue(newest(lot({ id: 4, location: 'Trade box' })))
    renderPlate()
    expect(
      await screen.findByRole('link', { name: 'Move it to another Volume' }),
    ).toHaveAttribute('href', '/catalog/4')
    expect(
      screen.queryByRole('link', { name: 'Shelve it in a Volume' }),
    ).not.toBeInTheDocument()
  })

  it('opens the folio with a back link to the bare Index', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue(newest(CROWN))
    renderPlate()

    const open = await screen.findByRole('link', { name: 'Open the folio' })
    expect(open).toHaveAttribute('href', '/index/edgar-voc')
    expect(open).toHaveClass('btn', 'btn--ghost')
    await user.click(open)
    expect(screen.getByRole('status', { name: 'Arrived' })).toHaveTextContent(
      '/index/edgar-voc {"indexSearch":""}',
    )
  })

  it('calls a lot with a blank Volume unshelved and offers to shelve it', async () => {
    listMock.mockResolvedValue(newest(lot({ quantity: 1, location: '  ' })))
    renderPlate()
    expect(
      await screen.findByText(
        'One copy, near mint, unshelved. Not yet claimed by any Tome.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Shelve it in a Volume' }),
    ).toBeInTheDocument()
  })

  it('trims the Volume it names', async () => {
    listMock.mockResolvedValue(
      newest(lot({ quantity: 1, location: ' Red binder ' })),
    )
    renderPlate()
    expect(
      await screen.findByText(
        'One copy, near mint, in Red binder. Not yet claimed by any Tome.',
      ),
    ).toBeInTheDocument()
  })

  it('opens the folio carrying the sorted, listed Index it came from', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue(newest(CROWN))
    renderPlate('/index?sort=name&view=list')

    await user.click(
      await screen.findByRole('link', { name: 'Open the folio' }),
    )
    expect(screen.getByRole('status', { name: 'Arrived' })).toHaveTextContent(
      '/index/edgar-voc {"indexSearch":"?sort=name&view=list"}',
    )
  })

  it('shelves the lot with a back link to the sorted, listed Index', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue(newest(CROWN))
    renderPlate('/index?sort=name&view=list')

    await user.click(
      await screen.findByRole('link', { name: 'Shelve it in a Volume' }),
    )
    expect(screen.getByRole('status', { name: 'Arrived' })).toHaveTextContent(
      '/catalog/7 {"back":{"to":"/index?sort=name&view=list","label":"Back to the Index"}}',
    )
  })

  it('renders nothing when the collection holds no lot', async () => {
    listMock.mockResolvedValue(newest())
    const { container } = renderPlate()
    await vi.waitFor(() => expect(listMock).toHaveBeenCalled())
    // Let the answer land and render before looking.
    await act(() => listMock.mock.results[0].value)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the lot loads', () => {
    listMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderPlate()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the lot cannot be read', async () => {
    listMock.mockRejectedValue(new ApiError('database is locked', 500))
    const { container } = renderPlate()
    await vi.waitFor(() => expect(listMock).toHaveBeenCalled())
    await act(async () => {
      await listMock.mock.results[0].value.catch(() => undefined)
    })
    expect(container).toBeEmptyDOMElement()
  })
})
