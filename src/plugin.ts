import type { Config, Plugin, PluginInput } from '@opencode-ai/plugin'
import { ModelCache, isFresh, type CacheIdentity } from './cache.js'
import { parseDiscoveryConfig } from './config.js'
import { fetchModels, normalizeBaseURL } from './discovery.js'
import { applyReasoningVariants, selectModels, type ModelMap } from './model.js'

export const REFRESH_COMMAND = 'models-fetch:refresh'

const REFRESH_TEMPLATE = `The opencode-models-fetch plugin has processed this cache deletion request.

Tell the user that the selected discovery cache has been deleted and that they must quit and restart OpenCode to fetch models again. Do not attempt to delete files or fetch models yourself.`

interface Dependencies {
  cache?: ModelCache
  fetcher?: typeof fetch
}

interface ProviderConfig {
  npm?: string
  api?: string
  options?: Record<string, unknown> & {
    baseURL?: string
    apiKey?: string
    modelsDiscovery?: unknown
  }
  models?: ModelMap
}

type MutableConfig = Config & {
  provider?: Record<string, ProviderConfig>
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function createLogger(client: PluginInput['client']) {
  return (level: LogLevel, message: string, extra: Record<string, unknown> = {}) => {
    const call = client?.app?.log?.({
      body: {
        service: 'opencode-models-fetch',
        level,
        message,
        extra,
      },
    })
    if (call && typeof call.catch === 'function') call.catch(() => {})
  }
}

function ensureRefreshCommand(config: MutableConfig): void {
  config.command ??= {}
  config.command[REFRESH_COMMAND] ??= {
    description: 'Delete the model discovery cache and restart OpenCode to refresh models',
    agent: 'build',
    template: REFRESH_TEMPLATE,
  }
}

function explicitModels(models: ModelMap, previous: Map<string, unknown> | undefined): ModelMap {
  if (!previous) return models
  return Object.fromEntries(Object.entries(models).filter(([id, model]) => previous.get(id) !== model))
}

function identity(provider: string, baseURL: string, endpoint: string): CacheIdentity {
  return {
    provider,
    baseURL: normalizeBaseURL(baseURL),
    endpoint,
  }
}

export function createModelDiscoveryPlugin(dependencies: Dependencies = {}): Plugin {
  return async (input) => {
    const cache = dependencies.cache ?? new ModelCache()
    const fetcher = dependencies.fetcher ?? fetch
    const log = createLogger(input.client)
    const injected = new WeakMap<object, Map<string, Map<string, unknown>>>()
    const background = new Set<Promise<void>>()
    let cacheEpoch = 0

    const rememberInjected = (config: object, provider: string, models: ModelMap) => {
      let providers = injected.get(config)
      if (!providers) {
        providers = new Map()
        injected.set(config, providers)
      }
      providers.set(provider, new Map(Object.entries(models)))
    }

    const refresh = async (
      cacheIdentity: CacheIdentity,
      baseURL: string,
      endpoint: string,
      headers: Record<string, string>,
      apiKey: string | undefined,
      epoch: number,
    ): Promise<ModelMap | undefined> => {
      const models = await fetchModels(baseURL, endpoint, headers, apiKey, fetcher)
      if (!models) {
        log('warn', 'Model discovery request failed; retaining cached models', { provider: cacheIdentity.provider })
        return undefined
      }
      if (epoch === cacheEpoch) {
        await cache.write(cacheIdentity, models).catch((error) => {
          log('warn', 'Could not write model discovery cache', {
            provider: cacheIdentity.provider,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
      return models
    }

    const runInBackground = (task: Promise<void>) => {
      background.add(task)
      task.finally(() => background.delete(task)).catch(() => {})
    }

    return {
      config: async (rawConfig) => {
        const config = rawConfig as MutableConfig
        ensureRefreshCommand(config)

        for (const [providerID, provider] of Object.entries(config.provider ?? {})) {
          const discovery = parseDiscoveryConfig(provider.options?.modelsDiscovery)
          const baseURL = provider.options?.baseURL
          if (!discovery.enabled || typeof baseURL !== 'string' || baseURL.length === 0) continue

          const cacheIdentity = identity(providerID, baseURL, discovery.endpoint)
          const previous = injected.get(config)?.get(providerID)
          const configured = explicitModels(provider.models ?? {}, previous)
          const apply = (models: ModelMap) => {
            const selected = selectModels(models, discovery, (pattern) => {
              log('warn', 'Ignoring invalid discovery regex', { provider: providerID, pattern })
            })
            const projected = applyReasoningVariants(selected, provider.npm)
            provider.models = { ...projected, ...configured }
            rememberInjected(config, providerID, projected)
            log('info', 'Injected discovered models', { provider: providerID, count: Object.keys(projected).length })
          }

          if (!discovery.cache.enabled) {
            const models = await fetchModels(
              baseURL,
              discovery.endpoint,
              discovery.headers,
              provider.options?.apiKey,
              fetcher,
            )
            if (models) apply(models)
            continue
          }

          const state = await cache.read(cacheIdentity)
          if (state) {
            apply(state.models)
            if (!isFresh(state, discovery.cache.ttlSeconds)) {
              const epoch = cacheEpoch
              runInBackground(
                refresh(
                  cacheIdentity,
                  baseURL,
                  discovery.endpoint,
                  discovery.headers,
                  provider.options?.apiKey,
                  epoch,
                ).then(() => {}),
              )
            }
            continue
          }

          const models = await refresh(
            cacheIdentity,
            baseURL,
            discovery.endpoint,
            discovery.headers,
            provider.options?.apiKey,
            cacheEpoch,
          )
          if (models) apply(models)
        }
      },
      'command.execute.before': async (command) => {
        if (command.command.replace(/^\//, '') !== REFRESH_COMMAND) return
        const provider = command.arguments.trim() || undefined
        cacheEpoch++
        try {
          await Promise.allSettled(background)
          await cache.clear(provider)
          const target = provider ? `provider '${provider}'` : 'all providers'
          log('info', 'Deleted model discovery cache', { provider: provider ?? 'all' })
          await input.client.tui
            .showToast({
              body: {
                title: 'Model Discovery Cache Deleted',
                message: `Deleted cache for ${target}. Restart OpenCode to fetch models again.`,
                variant: 'success',
              },
            })
            .catch(() => {})
        } catch (error) {
          log('error', 'Could not delete model discovery cache', {
            provider: provider ?? 'all',
            error: error instanceof Error ? error.message : String(error),
          })
          await input.client.tui
            .showToast({
              body: {
                title: 'Cache Deletion Failed',
                message: 'The model discovery cache could not be deleted.',
                variant: 'error',
              },
            })
            .catch(() => {})
        }
      },
      dispose: async () => {
        await Promise.allSettled(background)
      },
    }
  }
}

export const ModelDiscoveryPlugin = createModelDiscoveryPlugin()
