import { describe, expect, it } from 'vitest'
import { INDEX_PAGE_SIZE } from '../api'
import {
  EMPTY_INDEX,
  defaultOrder,
  isFiltered,
  readIndexParams,
  refine,
  toSearchParams,
  writeIndexParams,
  type IndexState,
} from './indexParams'

function read(query: string): IndexState {
  return readIndexParams(new URLSearchParams(query))
}

describe('readIndexParams', () => {
  it('reads a bare URL as the unfiltered first page, newest first, in a grid', () => {
    expect(read('')).toEqual(EMPTY_INDEX)
    expect(EMPTY_INDEX).toMatchObject({
      sort: 'added',
      order: 'desc',
      view: 'grid',
      page: 1,
      colorMode: 'colors',
    })
  })

  it('reads every filter under its API name', () => {
    expect(
      read(
        'name=bolt&set=lea&set=2x2&colors=R&type=Instant&tag=trade' +
          '&location=Red+binder&finish=foil&condition=NM&condition=LP' +
          '&sort=name&order=desc&view=list&page=3',
      ),
    ).toEqual({
      name: 'bolt',
      sets: ['lea', '2x2'],
      colors: ['R'],
      colorMode: 'colors',
      type: 'Instant',
      tags: ['trade'],
      locations: ['Red binder'],
      finishes: ['foil'],
      conditions: ['NM', 'LP'],
      sort: 'name',
      order: 'desc',
      view: 'list',
      page: 3,
    })
  })

  it('drops values outside the enums instead of sending a request the API rejects', () => {
    const state = read(
      'finish=shiny&finish=foil&condition=Mint&colors=X&colors=U' +
        '&sort=price&order=sideways&view=carousel',
    )
    expect(state.finishes).toEqual(['foil'])
    expect(state.conditions).toEqual([])
    expect(state.colors).toEqual(['U'])
    expect(state.sort).toBe('added')
    expect(state.order).toBe('desc')
    expect(state.view).toBe('grid')
  })

  it('drops blank and repeated list values', () => {
    expect(read('set=&set=lea&set=lea&tag=').sets).toEqual(['lea'])
    expect(read('set=&set=lea&set=lea&tag=').tags).toEqual([])
  })

  it.each(['0', '-3', '1.5', 'two'])(
    'falls back to the first page on ?page=%s',
    (page) => {
      expect(read(`page=${page}`).page).toBe(1)
    },
  )

  it.each([
    ['added', 'desc'],
    ['quantity', 'desc'],
    ['name', 'asc'],
    ['set', 'asc'],
  ] as const)('defaults the order for %s to %s', (sort, order) => {
    expect(defaultOrder(sort)).toBe(order)
    expect(read(`sort=${sort}`).order).toBe(order)
  })

  it('reads color_identity values as the "fits within" mode', () => {
    const state = read('color_identity=W&color_identity=B')
    expect(state.colorMode).toBe('identity')
    expect(state.colors).toEqual(['W', 'B'])
  })

  it('prefers color_identity when a hand-written URL carries both', () => {
    const state = read('colors=R&color_identity=U')
    expect(state.colorMode).toBe('identity')
    expect(state.colors).toEqual(['U'])
  })
})

describe('writeIndexParams', () => {
  it('writes nothing for the default state', () => {
    expect(writeIndexParams(EMPTY_INDEX).toString()).toBe('')
  })

  it('round trips a filtered, sorted, paged state', () => {
    const query =
      'name=Fire+%26+Ice&set=lea&color_identity=R&color_identity=U' +
      '&type=Instant&tag=trade&location=Red+binder&finish=foil' +
      '&condition=LP&sort=name&order=desc&view=list&page=2'
    expect(writeIndexParams(read(query)).toString()).toBe(query)
  })

  it('leaves out the order when it is the default for the sort', () => {
    expect(
      writeIndexParams({
        ...EMPTY_INDEX,
        sort: 'name',
        order: 'asc',
      }).toString(),
    ).toBe('sort=name')
    expect(writeIndexParams({ ...EMPTY_INDEX, order: 'asc' }).toString()).toBe(
      'order=asc',
    )
  })

  it('writes checked colors under the param the mode names', () => {
    const colors = { ...EMPTY_INDEX, colors: ['G' as const] }
    expect(writeIndexParams(colors).toString()).toBe('colors=G')
    expect(
      writeIndexParams({ ...colors, colorMode: 'identity' }).toString(),
    ).toBe('color_identity=G')
  })
})

describe('refine', () => {
  const paged: IndexState = { ...EMPTY_INDEX, page: 4, view: 'list' }

  it('drops the page when a filter changes and keeps the view', () => {
    expect(refine(paged, { finishes: ['foil'] })).toEqual({
      ...paged,
      finishes: ['foil'],
      page: 1,
    })
  })

  it('drops the page when the search text, sort or order changes', () => {
    expect(refine(paged, { name: 'sol' }).page).toBe(1)
    expect(refine(paged, { sort: 'name' }).page).toBe(1)
    expect(refine(paged, { order: 'asc' }).page).toBe(1)
  })

  it('resets the order to the new sort key default unless one is given', () => {
    expect(refine(EMPTY_INDEX, { sort: 'name' }).order).toBe('asc')
    expect(refine(EMPTY_INDEX, { sort: 'name', order: 'desc' }).order).toBe(
      'desc',
    )
  })
})

describe('isFiltered', () => {
  it('ignores sort, order, view and page', () => {
    expect(
      isFiltered({
        ...EMPTY_INDEX,
        sort: 'name',
        order: 'desc',
        view: 'list',
        page: 2,
      }),
    ).toBe(false)
  })

  it.each([
    { name: 'bolt' },
    { sets: ['lea'] },
    { colors: ['R' as const] },
    { type: 'Instant' },
    { tags: ['trade'] },
    { locations: ['Red binder'] },
    { finishes: ['foil' as const] },
    { conditions: ['LP' as const] },
  ])('counts %o as a filter', (patch) => {
    expect(isFiltered({ ...EMPTY_INDEX, ...patch })).toBe(true)
  })
})

describe('toSearchParams', () => {
  it('pages by the Index page size and always names the sort', () => {
    expect(toSearchParams({ ...EMPTY_INDEX, page: 3 })).toEqual({
      sort: 'added',
      order: 'desc',
      limit: INDEX_PAGE_SIZE,
      offset: 2 * INDEX_PAGE_SIZE,
    })
  })

  it('maps each filter onto its API name and trims the search text', () => {
    expect(
      toSearchParams({
        ...EMPTY_INDEX,
        name: '  bolt ',
        sets: ['lea'],
        type: 'Instant',
        tags: ['trade'],
        locations: ['Red binder'],
        finishes: ['foil'],
        conditions: ['NM'],
      }),
    ).toMatchObject({
      name: 'bolt',
      set: ['lea'],
      type: 'Instant',
      tag: ['trade'],
      location: ['Red binder'],
      finish: ['foil'],
      condition: ['NM'],
    })
  })

  it('sends the colors as colors or color_identity by mode, never both', () => {
    const printed = toSearchParams({ ...EMPTY_INDEX, colors: ['R'] })
    expect(printed.colors).toEqual(['R'])
    expect(printed).not.toHaveProperty('color_identity')

    const identity = toSearchParams({
      ...EMPTY_INDEX,
      colors: ['R'],
      colorMode: 'identity',
    })
    expect(identity.color_identity).toEqual(['R'])
    expect(identity).not.toHaveProperty('colors')
  })
})
