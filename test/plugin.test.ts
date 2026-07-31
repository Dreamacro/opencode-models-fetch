import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelCache } from '../src/cache.js'
import { createModelDiscoveryPlugin, REFRESH_COMMAND } from '../src/plugin.js'

function pluginInput() {
  return {
    client: {
      app: { log: vi.fn(async () => true) },
      tui: { showToast: vi.fn(async () => true) },
    },
    project: {},
    directory: '/tmp',
    worktree: '/tmp',
    serverUrl: new URL('http://localhost'),
    experimental_workspace: { register: vi.fn() },
    $: vi.fn(),
  } as any
}

function providerConfig(cache: Record<string, unknown> = {}) {
  return {
    provider: {
      gateway: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: 'https://gateway.test/v1',
          modelsDiscovery: { cache },
        },
        models: {
          explicit: { id: 'explicit', name: 'Explicit' },
        },
      },
    },
  } as any
}

describe('OpenCode plugin', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('injects stale cache immediately and retains it when background refresh fails', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'model-plugin-'))
    const cache = new ModelCache(root)
    const identity = { provider: 'gateway', baseURL: 'https://gateway.test', endpoint: '/v1/models' }
    await cache.write(identity, { cached: { id: 'cached', name: 'Cached' } })

    let resolveRequest!: (response: Response) => void
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const hooks = await createModelDiscoveryPlugin({ cache, fetcher: request })(pluginInput())
    const config = providerConfig({ ttlSeconds: 0 })

    await hooks.config!(config)

    expect(config.provider.gateway.models).toEqual({
      cached: { id: 'cached', name: 'Cached' },
      explicit: { id: 'explicit', name: 'Explicit' },
    })
    expect(request).toHaveBeenCalledOnce()

    resolveRequest(new Response('unavailable', { status: 503 }))
    await hooks.dispose!()
    expect((await cache.read(identity))?.models.cached).toBeDefined()
  })

  it('updates stale cache asynchronously for the next restart', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'model-plugin-'))
    const cache = new ModelCache(root)
    const identity = { provider: 'gateway', baseURL: 'https://gateway.test', endpoint: '/v1/models' }
    await cache.write(identity, { old: { id: 'old' } })
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: { next: { id: 'next', provider: { npm: '@ai-sdk/anthropic' } } },
          }),
          { status: 200 },
        ),
    )
    const hooks = await createModelDiscoveryPlugin({ cache, fetcher: request })(pluginInput())
    const config = providerConfig({ ttlSeconds: 0 })

    await hooks.config!(config)
    expect(config.provider.gateway.models.old).toBeDefined()
    expect(config.provider.gateway.models.next).toBeUndefined()

    await hooks.dispose!()
    expect((await cache.read(identity))?.models.next.provider).toEqual({ npm: '@ai-sdk/anthropic' })
  })

  it('deletes selected cache through the refresh command and asks for a restart', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'model-plugin-'))
    const cache = new ModelCache(root)
    const identity = { provider: 'gateway', baseURL: 'https://gateway.test', endpoint: '/v1/models' }
    await cache.write(identity, { cached: { id: 'cached' } })
    const input = pluginInput()
    const hooks = await createModelDiscoveryPlugin({ cache })(input)
    const config = providerConfig()

    await hooks.config!(config)
    expect(config.command[REFRESH_COMMAND]).toEqual(
      expect.objectContaining({
        description: expect.stringContaining('Delete'),
      }),
    )

    await hooks['command.execute.before']!(
      {
        command: REFRESH_COMMAND,
        sessionID: 'session',
        arguments: 'gateway',
      },
      { parts: [] },
    )

    await expect(cache.read(identity)).resolves.toBeUndefined()
    expect(input.client.tui.showToast).toHaveBeenCalledWith({
      body: expect.objectContaining({ message: expect.stringContaining('Restart OpenCode') }),
    })
  })
})
