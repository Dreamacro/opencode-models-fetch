import { describe, expect, it, vi } from 'vitest'
import { buildDiscoveryURL, DISCOVERY_USER_AGENT, fetchModels, normalizeBaseURL } from '../src/discovery.js'

describe('model discovery request', () => {
  it('normalizes a /v1 base URL and sends dedicated and custom headers', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: { model: { id: 'model', name: 'Model' } },
          }),
          { status: 200 },
        ),
    )

    const models = await fetchModels(
      'https://gateway.test/v1/',
      '/v1/models',
      { 'X-Tenant': 'tenant', 'User-Agent': 'ignored' },
      'secret',
      request,
    )

    expect(buildDiscoveryURL('https://gateway.test/v1/', '/v1/models')).toBe('https://gateway.test/v1/models')
    expect(normalizeBaseURL('https://gateway.test/v1/')).toBe('https://gateway.test')
    expect(models?.model.name).toBe('Model')
    const [, init] = request.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const headers = init.headers as Headers
    expect(headers.get('User-Agent')).toBe(DISCOVERY_USER_AGENT)
    expect(headers.get('X-Tenant')).toBe('tenant')
    expect(headers.get('Authorization')).toBe('Bearer secret')
  })

  it('resolves relative endpoints with the URL standard library', () => {
    expect(buildDiscoveryURL('https://gateway.test/api/v1', 'catalog/models?active=true')).toBe(
      'https://gateway.test/api/catalog/models?active=true',
    )
    expect(() => buildDiscoveryURL('https://gateway.test', 'file:///tmp/models.json')).toThrow(
      'Unsupported discovery URL protocol',
    )
  })

  it('rejects responses outside the models wrapper', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(fetchModels('https://gateway.test', '/v1/models', {}, undefined, request)).resolves.toBeUndefined()
  })

  it('does not forward a provider API key to an absolute cross-origin endpoint', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ models: {} }), { status: 200 }))

    await fetchModels('https://gateway.test/v1', 'https://catalog.test/v1/models', {}, 'secret', request)

    const [, init] = request.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect((init.headers as Headers).has('Authorization')).toBe(false)
  })
})
