import type { PluginModule } from '@opencode-ai/plugin'
import { ModelDiscoveryPlugin } from './plugin.js'

export default {
  id: 'opencode-models-fetch',
  server: ModelDiscoveryPlugin,
} satisfies PluginModule

export { ModelDiscoveryPlugin, createModelDiscoveryPlugin, REFRESH_COMMAND } from './plugin.js'
export { ModelCache, isFresh } from './cache.js'
export { buildDiscoveryURL, DISCOVERY_USER_AGENT, fetchModels, normalizeBaseURL } from './discovery.js'
export { sanitizeModels, selectModels } from './model.js'
