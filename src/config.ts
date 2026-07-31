import type { ModelInclude, ModelSelection } from './model.js'

export const DEFAULT_ENDPOINT = '/v1/models'
export const DEFAULT_CACHE_TTL_SECONDS = 86400

export interface CacheConfig {
  enabled: boolean
  ttlSeconds: number
}

export interface DiscoveryConfig extends ModelSelection {
  enabled: boolean
  endpoint: string
  headers: Record<string, string>
  cache: CacheConfig
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function headers(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function includes(value: unknown): ModelInclude[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ModelInclude>((rule): ModelInclude[] => {
    if (typeof rule === 'string') return [rule]
    if (!isObject(rule) || typeof rule.match !== 'string' || rule.match.length === 0) return []
    return [
      {
        match: rule.match,
        ...(typeof rule.npm === 'string' && rule.npm.length > 0 ? { npm: rule.npm } : {}),
        ...(typeof rule.api === 'string' && rule.api.length > 0 ? { api: rule.api } : {}),
      },
    ]
  })
}

export function parseDiscoveryConfig(value: unknown): DiscoveryConfig {
  const config = isObject(value) ? value : {}
  const cache = isObject(config.cache) ? config.cache : {}
  const ttl =
    typeof cache.ttlSeconds === 'number' && Number.isFinite(cache.ttlSeconds) && cache.ttlSeconds >= 0
      ? cache.ttlSeconds
      : DEFAULT_CACHE_TTL_SECONDS

  return {
    enabled: config.enabled !== false,
    endpoint: typeof config.endpoint === 'string' && config.endpoint.length > 0 ? config.endpoint : DEFAULT_ENDPOINT,
    headers: headers(config.headers),
    include: includes(config.include),
    exclude: stringArray(config.exclude),
    cache: {
      enabled: cache.enabled !== false,
      ttlSeconds: ttl,
    },
  }
}
