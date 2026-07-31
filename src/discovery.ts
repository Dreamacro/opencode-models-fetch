import { sanitizeModels, type ModelMap } from './model.js'

export const DISCOVERY_USER_AGENT = 'opencode/discovery'
const REQUEST_TIMEOUT_MS = 10_000

export function normalizeBaseURL(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (url.pathname.endsWith('/v1')) url.pathname = url.pathname.slice(0, -3)
  if (!url.pathname) url.pathname = '/'
  return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href.replace(/\/$/, '')
}

export function buildDiscoveryURL(baseURL: string, endpoint: string): string {
  if (URL.canParse(endpoint)) {
    const absolute = new URL(endpoint)
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
      throw new TypeError(`Unsupported discovery URL protocol: ${absolute.protocol}`)
    }
    return absolute.href
  }

  const base = new URL(normalizeBaseURL(baseURL))
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  let relativeEndpoint = endpoint
  while (relativeEndpoint.startsWith('/')) relativeEndpoint = relativeEndpoint.slice(1)
  return new URL(relativeEndpoint, base).href
}

function isSameOrigin(baseURL: string, discoveryURL: string): boolean {
  try {
    return new URL(baseURL).origin === new URL(discoveryURL).origin
  } catch {
    return false
  }
}

export async function fetchModels(
  baseURL: string,
  endpoint: string,
  customHeaders: Record<string, string>,
  apiKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelMap | undefined> {
  try {
    const url = buildDiscoveryURL(baseURL, endpoint)
    const headers = new Headers({ Accept: 'application/json', ...customHeaders })
    headers.set('User-Agent', DISCOVERY_USER_AGENT)
    if (apiKey && isSameOrigin(baseURL, url) && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${apiKey}`)
    }

    const response = await fetcher(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('models' in body)) return undefined
    return sanitizeModels((body as { models: unknown }).models)
  } catch {
    return undefined
  }
}
