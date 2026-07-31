import { describe, expect, it, vi } from 'vitest'
import { sanitizeModels, selectModels } from '../src/model.js'

describe('models.dev model projection', () => {
  it('keeps supported OpenCode fields and removes unsupported models.dev extensions', () => {
    const models = sanitizeModels({
      claude: {
        id: 'claude-upstream',
        name: 'Claude',
        reasoning: true,
        structured_output: true,
        experimental: { modes: { fast: {} } },
        provider: { npm: '@ai-sdk/anthropic', api: 'https://gateway.test', ignored: true },
        limit: { context: 200000, output: 64000 },
      },
    })

    expect(models).toEqual({
      claude: {
        id: 'claude-upstream',
        name: 'Claude',
        reasoning: true,
        provider: { npm: '@ai-sdk/anthropic', api: 'https://gateway.test' },
        limit: { context: 200000, output: 64000 },
      },
    })
  })

  it('filters models and applies protocol metadata from the first matching include rule', () => {
    const models = sanitizeModels({
      'claude-sonnet': { id: 'claude-sonnet' },
      'gpt-5': { id: 'gpt-5' },
      'text-embedding': { id: 'text-embedding' },
    })!

    const selected = selectModels(models, {
      include: [{ match: '^claude', npm: '@ai-sdk/anthropic' }, { match: '^gpt', npm: '@ai-sdk/openai' }, '^text-'],
      exclude: ['embedding'],
    })

    expect(selected['claude-sonnet'].provider).toEqual({ npm: '@ai-sdk/anthropic' })
    expect(selected['gpt-5'].provider).toEqual({ npm: '@ai-sdk/openai' })
    expect(selected['text-embedding']).toBeUndefined()
  })

  it('ignores invalid regex patterns', () => {
    const invalid = vi.fn()
    const models = sanitizeModels({ model: { id: 'model' } })!
    expect(selectModels(models, { include: ['['], exclude: [] }, invalid)).toEqual({})
    expect(invalid).toHaveBeenCalledWith('[')
  })
})
