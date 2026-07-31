import { describe, expect, it } from 'vitest'
import pluginModule from '../src/index.js'

describe('plugin package entrypoint', () => {
  it('exports an OpenCode server plugin module by default', () => {
    expect(pluginModule).toEqual(
      expect.objectContaining({
        id: 'opencode-models-fetch',
        server: expect.any(Function),
      }),
    )
  })
})
