import { Button } from './Button'
import { Field } from './Field'
import { Panel } from './Panel'
import { PrintingChip } from './PrintingChip'
import { Tag } from './Tag'
import { Input, Select, Textarea } from './controls'
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
