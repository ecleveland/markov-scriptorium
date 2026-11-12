import { describe, expect, it } from 'vitest'
import { filteredOpening, unfilteredOpening } from './opening'

describe('unfilteredOpening', () => {
  it('counts folios, Volumes and Tomes in words under one hundred', () => {
    expect(unfilteredOpening({ folios: 3, volumes: 2, tomes: 0 })).toBe(
      'Three folios, kept in two Volumes. No Tomes bound.',
    )
  })

  it('takes the singular for one of each', () => {
    expect(unfilteredOpening({ folios: 1, volumes: 1, tomes: 1 })).toBe(
      'One folio, kept in one Volume. One Tome bound.',
    )
  })

  it('sets a count of one hundred or more in figures', () => {
    expect(unfilteredOpening({ folios: 312, volumes: 9, tomes: 4 })).toBe(
      '312 folios, kept in nine Volumes. Four Tomes bound.',
    )
  })

  it('says none are shelved when there are no Volumes', () => {
    expect(unfilteredOpening({ folios: 3, volumes: 0, tomes: 0 })).toBe(
      'Three folios, none of them shelved in a Volume. No Tomes bound.',
    )
  })

  it('leaves the Volumes out while their count is unknown', () => {
    expect(unfilteredOpening({ folios: 3, tomes: 2 })).toBe(
      'Three folios. Two Tomes bound.',
    )
  })

  it('leaves the Tomes out while their count is unknown', () => {
    expect(unfilteredOpening({ folios: 40, volumes: 3 })).toBe(
      'Forty folios, kept in three Volumes.',
    )
  })

  it('says only the folios when neither other count is known', () => {
    expect(unfilteredOpening({ folios: 3 })).toBe('Three folios.')
  })
})

describe('filteredOpening', () => {
  it('quotes the name when the name is the only filter', () => {
    expect(
      filteredOpening({ total: 40, name: 'bolt', otherFilters: false }),
    ).toBe("Forty folios match 'bolt'.")
  })

  it('takes the singular verb for one folio', () => {
    expect(
      filteredOpening({ total: 1, name: 'bolt', otherFilters: false }),
    ).toBe("One folio matches 'bolt'.")
  })

  it('trims the name before quoting it', () => {
    expect(
      filteredOpening({ total: 2, name: '  sol ', otherFilters: false }),
    ).toBe("Two folios match 'sol'.")
  })

  it('names the filters when there is no name', () => {
    expect(filteredOpening({ total: 40, name: '', otherFilters: true })).toBe(
      'Forty folios match these filters.',
    )
  })

  it('treats a blank name as no name', () => {
    expect(filteredOpening({ total: 1, name: '   ', otherFilters: true })).toBe(
      'One folio matches these filters.',
    )
  })

  it('quotes the name within the filters when both narrow', () => {
    expect(
      filteredOpening({ total: 40, name: 'bolt', otherFilters: true }),
    ).toBe("Forty folios match 'bolt' within these filters.")
  })

  it('sets a total of one hundred or more in figures', () => {
    expect(
      filteredOpening({ total: 140, name: 'bolt', otherFilters: false }),
    ).toBe("140 folios match 'bolt'.")
  })
})
