export type ModelConfig = Record<string, unknown> & { id: string }
export type ModelMap = Record<string, ModelConfig>

export interface ModelIncludeRule {
  match: string
  npm?: string
  api?: string
}

export type ModelInclude = string | ModelIncludeRule

export interface ModelSelection {
  include: ModelInclude[]
  exclude: string[]
}

const MODEL_FIELDS = [
  'id',
  'name',
  'family',
  'release_date',
  'attachment',
  'reasoning',
  'temperature',
  'tool_call',
  'interleaved',
  'cost',
  'limit',
  'modalities',
  'experimental',
  'status',
  'provider',
  'options',
  'headers',
  'variants',
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): Record<string, string> | undefined {
  if (!isObject(value) || !Object.values(value).every((item) => typeof item === 'string')) return undefined
  return value as Record<string, string>
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeCost(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value) || !finite(value.input) || !finite(value.output)) return undefined
  const result: Record<string, unknown> = { input: value.input, output: value.output }
  if (finite(value.cache_read)) result.cache_read = value.cache_read
  if (finite(value.cache_write)) result.cache_write = value.cache_write
  if (
    isObject(value.context_over_200k) &&
    finite(value.context_over_200k.input) &&
    finite(value.context_over_200k.output)
  ) {
    result.context_over_200k = {
      input: value.context_over_200k.input,
      output: value.context_over_200k.output,
      ...(finite(value.context_over_200k.cache_read) ? { cache_read: value.context_over_200k.cache_read } : {}),
      ...(finite(value.context_over_200k.cache_write) ? { cache_write: value.context_over_200k.cache_write } : {}),
    }
  }
  return result
}

function sanitizeLimit(value: unknown): Record<string, number> | undefined {
  if (!isObject(value) || !finite(value.context) || !finite(value.output)) return undefined
  return {
    context: value.context,
    ...(finite(value.input) ? { input: value.input } : {}),
    output: value.output,
  }
}

const MODALITIES = new Set(['text', 'audio', 'image', 'video', 'pdf'])

function sanitizeModalities(value: unknown): Record<string, string[]> | undefined {
  if (!isObject(value)) return undefined
  const result: Record<string, string[]> = {}
  for (const field of ['input', 'output']) {
    const items = value[field]
    if (Array.isArray(items) && items.every((item) => typeof item === 'string' && MODALITIES.has(item))) {
      result[field] = items
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeProvider(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const result: Record<string, string> = {}
  if (typeof value.npm === 'string' && value.npm.length > 0) result.npm = value.npm
  if (typeof value.api === 'string' && value.api.length > 0) result.api = value.api
  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeInterleaved(value: unknown): unknown {
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (isObject(value) && typeof value.field === 'string') return { field: value.field }
  return undefined
}

function sanitizeField(field: (typeof MODEL_FIELDS)[number], value: unknown): unknown {
  if (field === 'id' || field === 'name' || field === 'family' || field === 'release_date') {
    return typeof value === 'string' ? value : undefined
  }
  if (['attachment', 'reasoning', 'temperature', 'tool_call', 'experimental'].includes(field)) {
    return typeof value === 'boolean' ? value : undefined
  }
  if (field === 'status') {
    return typeof value === 'string' && ['alpha', 'beta', 'deprecated', 'active'].includes(value) ? value : undefined
  }
  if (field === 'cost') return sanitizeCost(value)
  if (field === 'limit') return sanitizeLimit(value)
  if (field === 'modalities') return sanitizeModalities(value)
  if (field === 'provider') return sanitizeProvider(value)
  if (field === 'headers') return strings(value)
  if (field === 'interleaved') return sanitizeInterleaved(value)
  if ((field === 'options' || field === 'variants') && isObject(value)) return value
  return undefined
}

export function sanitizeModels(value: unknown): ModelMap | undefined {
  if (!isObject(value)) return undefined
  const models: ModelMap = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (!key || !isObject(candidate)) continue
    const id = typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : key
    const model: Record<string, unknown> = { id }
    for (const field of MODEL_FIELDS) {
      const sanitized = sanitizeField(field, candidate[field])
      if (sanitized !== undefined) model[field] = sanitized
    }
    model.id = id
    models[key] = model as ModelConfig
  }
  return models
}

function compile(patterns: string[], onInvalid?: (pattern: string) => void): RegExp[] {
  return patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern)]
    } catch {
      onInvalid?.(pattern)
      return []
    }
  })
}

export function selectModels(
  models: ModelMap,
  selection: ModelSelection,
  onInvalid?: (pattern: string) => void,
): ModelMap {
  const exclude = compile(selection.exclude, onInvalid)
  const include = selection.include.flatMap((rule) => {
    const pattern = typeof rule === 'string' ? rule : rule.match
    const compiled = compile([pattern], onInvalid)[0]
    return compiled ? [{ rule, pattern: compiled }] : []
  })

  return Object.fromEntries(
    Object.entries(models).flatMap(([key, model]) => {
      if (exclude.some((pattern) => pattern.test(key))) return []
      const matched = include.find((candidate) => candidate.pattern.test(key))
      if (selection.include.length > 0 && !matched) return []
      if (!matched || typeof matched.rule === 'string' || (!matched.rule.npm && !matched.rule.api)) {
        return [[key, model]]
      }
      return [
        [
          key,
          {
            ...model,
            provider: {
              ...(isObject(model.provider) ? model.provider : {}),
              ...(matched.rule.npm ? { npm: matched.rule.npm } : {}),
              ...(matched.rule.api ? { api: matched.rule.api } : {}),
            },
          } satisfies ModelConfig,
        ],
      ]
    }),
  )
}
