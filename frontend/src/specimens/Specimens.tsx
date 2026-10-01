import {
  Button,
  Consulting,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Panel,
  PrintingChip,
  Seal,
  Sealed,
  Select,
  Tag,
  Textarea,
} from '../components'
import { useArrowKeyList } from '../hooks/useArrowKeyList'
import './specimens.css'

const BOLT = {
  set_name: 'Limited Edition Alpha',
  set_code: 'lea',
  collector_number: '161',
  image_uris: null,
}

const SOL_RING = {
  set_name: 'Commander 2021',
  set_code: 'c21',
  collector_number: '263',
  image_uris: {
    // A 1x1 transparent GIF, so the specimen shows the thumbnail slot without
    // a network request.
    small:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  },
}

/**
 * Every component in every state on one page, for eyeballing the layer while
 * the pages that consume it are still being restyled. Mounted at `/specimens`
 * in development only (see App.tsx); never linked from the nav.
 */
export function Specimens() {
  const arrowKeys = useArrowKeyList()
  return (
    <section className="specimens">
      <h1>Specimens</h1>
      <p>The component layer, laid out for inspection.</p>

      <h2>Buttons</h2>
      <div className="specimens__row">
        <Button variant="primary" seal>
          Inscribe
        </Button>
        <Button variant="primary">Resolve decklist</Button>
        <Button>Change card</Button>
        <Button variant="ghost">Change</Button>
        <Button variant="danger">Remove from the catalog</Button>
        <Button variant="primary" disabled>
          Inscribing…
        </Button>
        <Button disabled>Disabled</Button>
      </div>

      <h2>Tags</h2>
      <div className="specimens__row">
        <Tag tone="success">ready</Tag>
        <Tag tone="warning">choose printing</Tag>
        <Tag tone="danger">unmatched</Tag>
        <Tag>foil</Tag>
      </div>

      <h2>Panel and fields</h2>
      <Panel as="fieldset">
        <legend>Applied to every inscribed card</legend>
        <Field label="Finish">
          <Select defaultValue="nonfoil">
            <option value="nonfoil">nonfoil</option>
            <option value="foil">foil</option>
            <option value="etched">etched</option>
          </Select>
        </Field>
        <Field label="Volume (location)">
          <Input type="text" placeholder="e.g. Binder I" />
        </Field>
        <Field label="Decklist">
          <Textarea
            rows={3}
            placeholder={'4 Lightning Bolt\n1 Sol Ring (cmd)'}
          />
        </Field>
        <Field label="Disabled">
          <Input type="text" defaultValue="Sealed" disabled />
        </Field>
      </Panel>

      <h2>Page header</h2>
      <PageHeader eyebrow="Section" title="A page heading" level={2}>
        <Button>Change card</Button>
      </PageHeader>

      <h2>Notices</h2>
      <Notice tone="danger">The catalog could not be reached.</Notice>
      <Notice tone="success">Inscribed 2 folios (5 copies).</Notice>
      <Notice>Consulting the catalog…</Notice>

      <h2>Seal</h2>
      <Seal className="specimens__seal" />

      <h2>Sealed</h2>
      <Sealed>Inscribed 2 folios (5 copies) into the catalog.</Sealed>

      <h2>Empty state</h2>
      <EmptyState title="Nothing inscribed yet">
        Inscribe a card, or bring in a decklist or a CSV, and it will be
        catalogued here.
      </EmptyState>

      <h2>Consulting</h2>
      <Consulting />

      <h2>Listbox</h2>
      <ul className="listbox" aria-label="Specimen printings" {...arrowKeys}>
        <li>
          <button
            type="button"
            className="listbox__option"
            aria-pressed={false}
          >
            <PrintingChip printing={BOLT} />
          </button>
        </li>
        <li>
          <button type="button" className="listbox__option" aria-pressed>
            <PrintingChip printing={SOL_RING} />
          </button>
        </li>
      </ul>

      <h2>Printing chips</h2>
      <p>
        <PrintingChip printing={BOLT} />
      </p>
      <p>
        <PrintingChip printing={SOL_RING} size="md" />
      </p>
    </section>
  )
}
