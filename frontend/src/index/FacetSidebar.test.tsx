import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { facets } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { FacetSidebar } from './FacetSidebar'
import { EMPTY_INDEX, readIndexParams, type IndexState } from './indexParams'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, listFacets: vi.fn() }
})

import { ApiError, listFacets } from '../api'

const facetsMock = vi.mocked(listFacets)

const STOCKED = facets({
  sets: [
    { set_code: '2x2', set_name: 'Double Masters 2022', folios: 1 },
    { set_code: 'lea', set_name: 'Limited Edition Alpha', folios: 3 },
  ],
  locations: [{ location: 'Red binder', folios: 2 }],
  tags: [{ tag: 'trade', folios: 1 }],
})

function renderSidebar(state: IndexState = EMPTY_INDEX) {
  const onRefine = vi.fn()
  renderWithQuery(<FacetSidebar state={state} onRefine={onRefine} />)
  return onRefine
}

function group(name: string) {
  return screen.getByRole('group', { name })
}

afterEach(() => vi.clearAllMocks())

describe('FacetSidebar', () => {
  it('lists each owned set, Volume and tag with its folio count', async () => {
    facetsMock.mockResolvedValue(STOCKED)
    renderSidebar()

    const alpha = await screen.findByRole('checkbox', {
      name: 'Limited Edition Alpha (LEA) 3 folios',
    })
    expect(alpha).not.toBeChecked()
    expect(
      within(group('Set')).getByRole('checkbox', {
        name: 'Double Masters 2022 (2X2) 1 folio',
      }),
    ).toBeInTheDocument()
    expect(
      within(group('Volume')).getByRole('checkbox', {
        name: 'Red binder 2 folios',
      }),
    ).toBeInTheDocument()
    expect(
      within(group('Tag')).getByRole('checkbox', { name: 'trade 1 folio' }),
    ).toBeInTheDocument()
  })

  it('names the sidebar as the filters', async () => {
    facetsMock.mockResolvedValue(STOCKED)
    renderSidebar()
    expect(
      screen.getByRole('complementary', { name: 'Filters' }),
    ).toBeInTheDocument()
  })

  it('checks the boxes the URL names', async () => {
    facetsMock.mockResolvedValue(STOCKED)
    renderSidebar(
      readIndexParams(
        new URLSearchParams(
          'set=lea&location=Red+binder&finish=foil&condition=LP&colors=R',
        ),
      ),
    )

    expect(
      await screen.findByRole('checkbox', { name: /^Limited Edition Alpha/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /^Double Masters/ }),
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Red binder/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'foil' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'nonfoil' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'LP' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Red' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Printed colors' })).toBeChecked()
  })

  it('keeps a checked value the facets no longer list, so it can be unchecked', async () => {
    facetsMock.mockResolvedValue(STOCKED)
    renderSidebar({ ...EMPTY_INDEX, tags: ['gone'] })
    expect(
      await screen.findByRole('checkbox', { name: 'gone 0 folios' }),
    ).toBeChecked()
  })

  it('adds and removes facet values through the callback', async () => {
    const user = userEvent.setup()
    facetsMock.mockResolvedValue(STOCKED)
    const onRefine = renderSidebar({ ...EMPTY_INDEX, sets: ['2x2'] })

    await user.click(
      await screen.findByRole('checkbox', { name: /^Limited Edition Alpha/ }),
    )
    expect(onRefine).toHaveBeenLastCalledWith({ sets: ['2x2', 'lea'] })

    await user.click(screen.getByRole('checkbox', { name: /^Double Masters/ }))
    expect(onRefine).toHaveBeenLastCalledWith({ sets: [] })

    await user.click(screen.getByRole('checkbox', { name: 'etched' }))
    expect(onRefine).toHaveBeenLastCalledWith({ finishes: ['etched'] })

    await user.click(screen.getByRole('checkbox', { name: 'DMG' }))
    expect(onRefine).toHaveBeenLastCalledWith({ conditions: ['DMG'] })

    await user.click(screen.getByRole('checkbox', { name: /^Red binder/ }))
    expect(onRefine).toHaveBeenLastCalledWith({ locations: ['Red binder'] })

    await user.click(screen.getByRole('checkbox', { name: /^trade/ }))
    expect(onRefine).toHaveBeenLastCalledWith({ tags: ['trade'] })
  })

  it('picks a card type from the select, and Any clears it', async () => {
    const user = userEvent.setup()
    facetsMock.mockResolvedValue(STOCKED)
    const onRefine = renderSidebar({ ...EMPTY_INDEX, type: 'Creature' })

    const select = within(group('Type')).getByRole('combobox', {
      name: 'Card type',
    })
    expect(select).toHaveValue('Creature')
    await user.selectOptions(select, 'Planeswalker')
    expect(onRefine).toHaveBeenLastCalledWith({ type: 'Planeswalker' })
    await user.selectOptions(select, 'Any')
    expect(onRefine).toHaveBeenLastCalledWith({ type: '' })
  })

  it('keeps a hand-typed type from the URL selectable', async () => {
    facetsMock.mockResolvedValue(STOCKED)
    renderSidebar({ ...EMPTY_INDEX, type: 'Goblin' })
    expect(screen.getByRole('combobox', { name: 'Card type' })).toHaveValue(
      'Goblin',
    )
  })

  it('sends checked colors in the mode the radio names', async () => {
    const user = userEvent.setup()
    facetsMock.mockResolvedValue(STOCKED)
    const onRefine = renderSidebar({ ...EMPTY_INDEX, colors: ['U'] })

    await user.click(screen.getByRole('checkbox', { name: 'Black' }))
    expect(onRefine).toHaveBeenLastCalledWith({
      colors: ['U', 'B'],
      colorMode: 'colors',
    })

    await user.click(
      screen.getByRole('radio', { name: 'Identity fits within' }),
    )
    expect(onRefine).toHaveBeenLastCalledWith({ colorMode: 'identity' })
  })

  it('shows the identity mode when the URL carries color_identity', () => {
    facetsMock.mockResolvedValue(STOCKED)
    renderSidebar(
      readIndexParams(new URLSearchParams('color_identity=G&color_identity=C')),
    )
    expect(
      screen.getByRole('radio', { name: 'Identity fits within' }),
    ).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Green' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Colorless' })).toBeChecked()
  })

  it('remembers a mode picked before any color is checked', async () => {
    const user = userEvent.setup()
    facetsMock.mockResolvedValue(STOCKED)
    const onRefine = renderSidebar()

    const identity = screen.getByRole('radio', { name: 'Identity fits within' })
    await user.click(identity)
    // Nothing is checked yet, so there is nothing to send.
    expect(onRefine).not.toHaveBeenCalled()
    expect(identity).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'White' }))
    expect(onRefine).toHaveBeenLastCalledWith({
      colors: ['W'],
      colorMode: 'identity',
    })
  })

  it('stays in identity mode when the last checked color is unchecked', async () => {
    const user = userEvent.setup()
    facetsMock.mockResolvedValue(STOCKED)
    const state = readIndexParams(new URLSearchParams('color_identity=G'))
    const onRefine = vi.fn()
    const { rerender } = renderWithQuery(
      <FacetSidebar state={state} onRefine={onRefine} />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Green' }))
    expect(onRefine).toHaveBeenLastCalledWith({
      colors: [],
      colorMode: 'identity',
    })
    // The URL now names no colors, so only the sidebar remembers the mode.
    rerender(<FacetSidebar state={EMPTY_INDEX} onRefine={onRefine} />)
    expect(
      screen.getByRole('radio', { name: 'Identity fits within' }),
    ).toBeChecked()
  })

  it('says so when the facet values cannot be read and keeps the fixed filters working', async () => {
    const user = userEvent.setup()
    facetsMock.mockRejectedValue(new ApiError('database is locked', 500))
    const onRefine = renderSidebar()

    expect(
      await screen.findByText('Facet values could not be read.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Set' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'Volume' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Tag' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'foil' }))
    expect(onRefine).toHaveBeenLastCalledWith({ finishes: ['foil'] })
    expect(group('Color')).toBeInTheDocument()
    expect(group('Type')).toBeInTheDocument()
    expect(group('Condition')).toBeInTheDocument()
  })

  it('leaves out a list facet the collection has no values for', async () => {
    facetsMock.mockResolvedValue(facets({ sets: STOCKED.sets }))
    renderSidebar()
    expect(
      await screen.findByRole('group', { name: 'Set' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Tag' })).not.toBeInTheDocument()
  })
})
