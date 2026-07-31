import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelCache, isFresh } from '../src/cache.js'

describe('model cache', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('persists provider-specific model inventories and clears them', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'model-cache-'))
    const cache = new ModelCache(root)
    const identity = { provider: 'gateway/a', baseURL: 'https://gateway.test', endpoint: '/v1/models' }
    await cache.write(identity, { model: { id: 'model' } })

    const state = await cache.read(identity)
    expect(state?.models).toEqual({ model: { id: 'model' } })
    expect(isFresh(state!, 86400)).toBe(true)

    await cache.clear('gateway/a')
    await expect(cache.read(identity)).resolves.toBeUndefined()
  })
})
