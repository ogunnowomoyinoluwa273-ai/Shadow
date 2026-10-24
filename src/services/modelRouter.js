const MODELS = Object.freeze({
  gemini: { id: 'gemini', label: 'Gemini 3.5 Flash', provider: 'gemini' },
  deepseek: { id: 'deepseek', label: 'DeepSeek V4.1 Flash', provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' }
})
const PENDING_TTL_MS = 120_000

export function createModelRouter({ store, fetchImpl = fetch, apiKey = process.env.NVIDIA_API_KEY?.trim(), endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions', logger = console } = {}) {
  const pending = new Map()
  const stored = store?.get?.()?.activeModel
  let active = MODELS[stored] ? stored : 'gemini'
  if (store && stored !== active) store.update?.(value => ({ ...(value || {}), activeModel: active })).catch(() => {})
  const activeModel = () => MODELS[active]
  const select = async id => { if (!MODELS[id]) throw new Error('Unknown AI model.'); active = id; if (store) await store.update(value => ({ ...(value || {}), activeModel: id })); return activeModel() }
  const menu = () => `♠️ SHADOW AI MODEL SELECTOR\n\nChoose the AI model you want SHADOW to use:\n\n1. ${MODELS.gemini.label}\n2. ${MODELS.deepseek.label}\n\nCurrent model: ${activeModel().label}\n\nReply with 1 or 2 to select a model.`
  const status = () => `Active AI model: ${activeModel().label} (${activeModel().provider}).${active === 'deepseek' && !apiKey ? '\nNVIDIA_API_KEY is not configured, so DeepSeek requests will fail until it is added.' : ''}`
  const beginPending = sender => { pending.set(String(sender), Date.now() + PENDING_TTL_MS); return menu() }
  const consumePending = async (sender, text) => { const key = String(sender); const expires = pending.get(key); if (!expires) return null; if (expires < Date.now()) { pending.delete(key); return null } const value = String(text || '').trim(); if (!['1', '2'].includes(value)) return null; pending.delete(key); const model = await select(value === '1' ? 'gemini' : 'deepseek'); return `Switched SHADOW to ${model.label}. This affects subsequent AI responses globally.` }
  const generate = async ({ input, systemInstruction, timeoutMs = 20_000 } = {}) => {
    if (active !== 'deepseek') throw new Error('DeepSeek provider is not active.')
    if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured. Switch back to Gemini or add the NVIDIA key to .env.')
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELS.deepseek.model, messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: input }], temperature: 1, top_p: 0.95, max_tokens: 1024, stream: false }), signal: controller.signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) { const error = new Error(payload?.error?.message || `NVIDIA request failed with HTTP ${response.status}`); error.status = response.status; throw error }
      const answer = payload?.choices?.[0]?.message?.content
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('NVIDIA returned an empty response.')
      logger.debug?.({ provider: 'nvidia', model: MODELS.deepseek.model, usage: payload.usage || null }, 'DeepSeek response completed')
      return answer.trim()
    } finally { clearTimeout(timer) }
  }
  return { models: MODELS, get active() { return activeModel() }, select, menu, status, beginPending, consumePending, generate }
}
