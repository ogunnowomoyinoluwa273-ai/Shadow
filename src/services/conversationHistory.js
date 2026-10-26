const normalizeTurn = turn => turn && (turn.role === 'user' || turn.role === 'model') && typeof turn.content === 'string' ? { role: turn.role, content: turn.content.slice(0, 6000) } : null

export function createPersistentContextStore(store, { maxTurns = 6, ttlMs = 30 * 60 * 1000 } = {}) {
  const queues = new Map()
  const read = key => {
    const record = store.get()?.[key]
    if (!record || typeof record !== 'object' || !Array.isArray(record.turns)) return []
    if (record.updatedAt && Date.now() - record.updatedAt > ttlMs) return []
    return record.turns.map(normalizeTurn).filter(Boolean).slice(-maxTurns)
  }
  const enqueue = (key, operation) => {
    const previous = queues.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(operation).finally(() => { if (queues.get(key) === next) queues.delete(key) })
    queues.set(key, next)
    return next
  }
  const get = key => read(String(key || ''))
  const add = (key, role, content) => enqueue(String(key || ''), async () => {
    const normalizedKey = String(key || '')
    if (!normalizedKey || !['user', 'model'].includes(role) || typeof content !== 'string' || !content.trim()) return
    await store.update(all => {
      const next = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
      const turns = read(normalizedKey).concat({ role, content: content.slice(0, 6000) }).slice(-maxTurns)
      next[normalizedKey] = { turns, updatedAt: Date.now() }
      return next
    })
  })
  const clear = key => enqueue(String(key || ''), async () => { await store.update(all => { const next = { ...(all || {}) }; delete next[String(key || '')]; return next }) })
  return { get, add, clear, size: () => Object.keys(store.get() || {}).length, flush: () => store.flush?.() }
}
