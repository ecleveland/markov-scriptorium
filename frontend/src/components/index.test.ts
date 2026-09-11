// @vitest-environment node
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as components from './index'

// The barrel is how pages import the layer, so a component file that is not
// re-exported from it is invisible to them. Every PascalCase module in this
// directory must appear in the barrel's exports.
describe('components barrel', () => {
  it('re-exports every component module', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const modules = readdirSync(dir)
      .filter((name) => /^[A-Z][A-Za-z]+\.tsx$/.test(name))
      .map((name) => name.replace(/\.tsx$/, ''))
    expect(modules.length).toBeGreaterThan(3)
    for (const name of modules) {
      expect(components, `barrel is missing ${name}`).toHaveProperty(name)
    }
    expect(components).toHaveProperty('Input')
    expect(components).toHaveProperty('describePrinting')
    expect(components).toHaveProperty('cx')
  })
})
