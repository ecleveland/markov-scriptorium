import { useQuery } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { COLORS, CONDITIONS, FINISHES, listFacets, type Color } from '../api'
import { inventoryKeys } from '../catalog/queryKeys'
import { Consulting, Notice, Panel, Select } from '../components'
import type { ColorMode, IndexRefinement, IndexState } from './indexParams'

const COLOR_NAMES: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

/** The search takes one type substring, so these are the common supertypes. */
const CARD_TYPES = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Land',
  'Battle',
]

/** `list` with `value` added at the end, or taken out if it was there. */
function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value]
}

interface FacetOption {
  value: string
  label: string
  folios: number
}

/**
 * Facet values plus any the URL checks that the facets no longer list (the
 * last copy left that Volume, say). Without them a stale filter could not be
 * unchecked.
 */
function withChecked(
  options: FacetOption[],
  checked: readonly string[],
  label: (value: string) => string,
): FacetOption[] {
  const listed = new Set(options.map((option) => option.value))
  const stale = checked
    .filter((value) => !listed.has(value))
    .map((value) => ({ value, label: label(value), folios: 0 }))
  return [...options, ...stale]
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className="facet__option">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="facet__label">{children}</span>
    </label>
  )
}

function FacetList({
  legend,
  options,
  checked,
  onToggle,
}: {
  legend: string
  options: FacetOption[]
  checked: readonly string[]
  onToggle: (value: string) => void
}) {
  if (options.length === 0) return null
  return (
    <fieldset className="facet">
      <legend>{legend}</legend>
      <div className="facet__options facet__options--scroll">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            checked={checked.includes(option.value)}
            onChange={() => onToggle(option.value)}
          >
            {option.label}{' '}
            <span className="facet__count">
              {option.folios}
              <span className="visually-hidden">
                {option.folios === 1 ? ' folio' : ' folios'}
              </span>
            </span>
          </Checkbox>
        ))}
      </div>
    </fieldset>
  )
}

/** The set, Volume and tag facets, read from what the collection holds. */
function OwnedFacets({ state, onRefine }: FacetSidebarProps) {
  const query = useQuery({
    queryKey: inventoryKeys.facets(),
    queryFn: () => listFacets(),
  })

  if (query.isPending) {
    return <Consulting>Gathering the facets…</Consulting>
  }
  if (query.isError) {
    return <Notice>Facet values could not be read.</Notice>
  }

  const { sets, locations, tags } = query.data
  return (
    <>
      <FacetList
        legend="Set"
        options={withChecked(
          sets.map((set) => ({
            value: set.set_code,
            label: `${set.set_name} (${set.set_code.toUpperCase()})`,
            folios: set.folios,
          })),
          state.sets,
          (code) => code.toUpperCase(),
        )}
        checked={state.sets}
        onToggle={(code) => onRefine({ sets: toggled(state.sets, code) })}
      />
      <FacetList
        legend="Volume"
        options={withChecked(
          locations.map((entry) => ({
            value: entry.location,
            label: entry.location,
            folios: entry.folios,
          })),
          state.locations,
          (value) => value,
        )}
        checked={state.locations}
        onToggle={(value) =>
          onRefine({ locations: toggled(state.locations, value) })
        }
      />
      <FacetList
        legend="Tag"
        options={withChecked(
          tags.map((entry) => ({
            value: entry.tag,
            label: entry.tag,
            folios: entry.folios,
          })),
          state.tags,
          (value) => value,
        )}
        checked={state.tags}
        onToggle={(value) => onRefine({ tags: toggled(state.tags, value) })}
      />
    </>
  )
}

export interface FacetSidebarProps {
  state: IndexState
  /** Called with the fields that changed. The page writes them to the URL. */
  onRefine: (change: IndexRefinement) => void
}

/**
 * The Index's filters. Every value lives in the URL and arrives here as
 * `state`; the sidebar holds nothing of its own but the color mode picked
 * before any color is checked, which the URL has no way to say.
 */
export function FacetSidebar({ state, onRefine }: FacetSidebarProps) {
  const radioName = useId()
  const [pendingMode, setPendingMode] = useState<ColorMode>('colors')
  const colorMode = state.colors.length > 0 ? state.colorMode : pendingMode
  const typeOptions =
    state.type === '' || CARD_TYPES.includes(state.type)
      ? CARD_TYPES
      : [...CARD_TYPES, state.type]

  function pickMode(mode: ColorMode) {
    setPendingMode(mode)
    if (state.colors.length > 0) onRefine({ colorMode: mode })
  }

  return (
    <Panel as="aside" aria-label="Filters" className="index__filters">
      <fieldset className="facet">
        <legend>Color</legend>
        <div className="facet__options facet__options--row">
          {COLORS.map((color) => (
            <Checkbox
              key={color}
              checked={state.colors.includes(color)}
              onChange={() => {
                // Unchecking the last color leaves the URL with no word for
                // the mode, so remember it here.
                setPendingMode(colorMode)
                onRefine({ colors: toggled(state.colors, color), colorMode })
              }}
            >
              {COLOR_NAMES[color]}
            </Checkbox>
          ))}
        </div>
        <div
          className="facet__options"
          role="radiogroup"
          aria-label="Color mode"
        >
          <label className="facet__option">
            <input
              type="radio"
              name={radioName}
              checked={colorMode === 'colors'}
              onChange={() => pickMode('colors')}
            />
            <span className="facet__label">Printed colors</span>
          </label>
          <label className="facet__option">
            <input
              type="radio"
              name={radioName}
              checked={colorMode === 'identity'}
              onChange={() => pickMode('identity')}
            />
            <span className="facet__label">Identity fits within</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="facet">
        <legend>Type</legend>
        <Select
          aria-label="Card type"
          value={state.type}
          onChange={(event) => onRefine({ type: event.target.value })}
        >
          <option value="">Any</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </fieldset>

      <fieldset className="facet">
        <legend>Finish</legend>
        <div className="facet__options">
          {FINISHES.map((finish) => (
            <Checkbox
              key={finish}
              checked={state.finishes.includes(finish)}
              onChange={() =>
                onRefine({ finishes: toggled(state.finishes, finish) })
              }
            >
              {finish}
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <fieldset className="facet">
        <legend>Condition</legend>
        <div className="facet__options facet__options--row">
          {CONDITIONS.map((grade) => (
            <Checkbox
              key={grade}
              checked={state.conditions.includes(grade)}
              onChange={() =>
                onRefine({ conditions: toggled(state.conditions, grade) })
              }
            >
              {grade}
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <OwnedFacets state={state} onRefine={onRefine} />
    </Panel>
  )
}
