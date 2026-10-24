import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelRouter } from '../src/services/modelRouter.js'

function store(initial = {}) { let value = initial; return { get: () => value, update: async fn => { value = await fn(value); return value }, value: () => value } }

test('model router defaults to Gemini and persists DeepSeek selection', async () => {
  const backing = store({})
  const router = createModelRouter({ store: backing, apiKey: 'nvidia-test' })
  assert.equal(router.active.id, 'gemini')
  await router.select('deepseek')
  assert.equal(router.active.model, 'deepseek-ai/deepseek-v4.1-flash')
  assert.equal(backing.value().activeModel, 'deepseek')
  assert.match(router.status(), /DeepSeek V4\.1 Flash/)
})

test('pending model selection is scoped and expires', async () => {
  const router = createModelRouter({ store: store({}), apiKey: 'test' })
  router.beginPending('owner@s.whatsapp.net')
  assert.equal(await router.consumePending('other@s.whatsapp.net', '2'), null)
  assert.match(await router.consumePending('owner@s.whatsapp.net', '2'), /DeepSeek/)
})

test('DeepSeek uses NVIDIA OpenAI-compatible endpoint and parses response', async () => {
  let request
  const router = createModelRouter({ store: store({ activeModel: 'deepseek' }), apiKey: 'nvidia-test', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'hello from deepseek' } }], usage: { total_tokens: 4 } }) } }, logger: { debug: () => {} } })
  const answer = await router.generate({ input: 'hello', systemInstruction: 'be concise' })
  assert.equal(answer, 'hello from deepseek')
  assert.equal(request.url, 'https://integrate.api.nvidia.com/v1/chat/completions')
  assert.equal(JSON.parse(request.options.body).model, 'deepseek-ai/deepseek-v4.1-flash')
  assert.equal(request.options.headers.authorization, 'Bearer nvidia-test')
})

test('missing NVIDIA credentials do not prevent Gemini selection', async () => {
  const router = createModelRouter({ store: store({}), apiKey: '' })
  assert.equal(router.active.id, 'gemini')
  await router.select('deepseek')
  await assert.rejects(() => router.generate({ input: 'hello', systemInstruction: 'be concise' }), /NVIDIA_API_KEY/)
})
