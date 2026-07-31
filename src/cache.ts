import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { sanitizeModels, type ModelMap } from './model.js'

const CACHE_VERSION = 1
const PLUGIN_DIRECTORY = 'opencode-models-fetch'

export interface CacheIdentity {
  provider: string
  baseURL: string
  endpoint: string
}

export interface CacheState {
  version: typeof CACHE_VERSION
  identity: CacheIdentity
  fetchedAt: string
  models: ModelMap
}

function defaultDataDirectory(): string {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return path.join(os.homedir(), '.local', 'share')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseState(value: unknown, identity: CacheIdentity): CacheState | undefined {
  if (
    !isObject(value) ||
    value.version !== CACHE_VERSION ||
    !isObject(value.identity) ||
    value.identity.provider !== identity.provider ||
    value.identity.baseURL !== identity.baseURL ||
    value.identity.endpoint !== identity.endpoint ||
    typeof value.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.fetchedAt))
  )
    return undefined
  const models = sanitizeModels(value.models)
  if (!models) return undefined
  return {
    version: CACHE_VERSION,
    identity,
    fetchedAt: value.fetchedAt,
    models,
  }
}

export function isFresh(state: CacheState, ttlSeconds: number, now = Date.now()): boolean {
  return Date.parse(state.fetchedAt) + ttlSeconds * 1000 > now
}

export class ModelCache {
  private readonly directory: string

  constructor(root = defaultDataDirectory()) {
    this.directory = path.join(root, PLUGIN_DIRECTORY, 'providers')
  }

  private file(provider: string): string {
    return path.join(this.directory, `provider-${encodeURIComponent(provider)}.json`)
  }

  async read(identity: CacheIdentity): Promise<CacheState | undefined> {
    try {
      return parseState(JSON.parse(await fs.readFile(this.file(identity.provider), 'utf8')), identity)
    } catch {
      return undefined
    }
  }

  async write(identity: CacheIdentity, models: ModelMap): Promise<void> {
    const target = this.file(identity.provider)
    const temporary = path.join(this.directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`)
    const state: CacheState = {
      version: CACHE_VERSION,
      identity,
      fetchedAt: new Date().toISOString(),
      models,
    }
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporary, target)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  async clear(provider?: string): Promise<void> {
    if (provider) {
      await fs.rm(this.file(provider), { force: true })
      return
    }
    await fs.rm(this.directory, { recursive: true, force: true })
  }
}
