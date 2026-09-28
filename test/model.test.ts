import { describe, expect, it, vi } from 'vitest'
import { applyReasoningVariants, sanitizeModels, selectModels } from '../src/model.js'

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

  it('keeps sanitized reasoning options for later variant projection', () => {
    const models = sanitizeModels({
      gpt: {
        id: 'gpt',
        reasoning: true,
        reasoning_options: [
          { type: 'effort', values: ['low', null, 5, 'max'] },
          { type: 'budget_tokens', min: 0, max: 'nope' },
          { type: 'unknown' },
        ],
      },
    })!

    expect(models.gpt.reasoning_options).toEqual([
      { type: 'effort', values: ['low', null, 'max'] },
      { type: 'budget_tokens', min: 0 },
    ])
  })

  it('projects effort reasoning options into OpenCode variants', () => {
    const models = sanitizeModels({
      gpt: {
        id: 'gpt',
        provider: { npm: '@ai-sdk/openai' },
        reasoning_options: [{ type: 'effort', values: ['low', 'high', null] }],
      },
      claude: { id: 'claude', reasoning_options: [{ type: 'effort', values: ['low', 'max'] }] },
      google: {
        id: 'google',
        provider: { npm: '@ai-sdk/google' },
        reasoning_options: [{ type: 'effort', values: ['high'] }],
      },
      toggle: { id: 'toggle', provider: { npm: '@ai-sdk/anthropic' }, reasoning_options: [{ type: 'toggle' }] },
    })!

    const projected = applyReasoningVariants(models, '@ai-sdk/anthropic')

    expect(projected.gpt.variants).toEqual({
      low: { reasoningEffort: 'low' },
      high: { reasoningEffort: 'high' },
      none: { reasoningEffort: 'none' },
    })
    expect(projected.gpt.reasoning_options).toBeUndefined()
    expect(projected.claude.variants).toEqual({ low: { effort: 'low' }, max: { effort: 'max' } })
    expect(projected.google.variants).toEqual({
      high: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } },
    })
    expect(projected.toggle.variants).toBeUndefined()
  })

  it('merges projected variants over upstream variants', () => {
    const models = sanitizeModels({
      model: {
        id: 'model',
        provider: { npm: '@openrouter/ai-sdk-provider' },
        variants: { custom: { reasoning: { effort: 'custom' } } },
        reasoning_options: [{ type: 'effort', values: ['high'] }],
      },
    })!

    expect(Object.keys(applyReasoningVariants(models, undefined).model.variants!)).toEqual(['custom', 'high'])
  })
})
