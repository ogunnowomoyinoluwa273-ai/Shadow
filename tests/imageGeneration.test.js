import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageGenerationService } from '../src/services/imageGeneration.js'

test('image generation is optional and disabled without its separate key', async () => {
  const service = createImageGenerationService({ apiKey: '', client: null })
  assert.equal(service.enabled, false)
  await assert.rejects(() => service.generate('a red fox'), /IMAGE_API_KEY|not configured/i)
})

test('image generation validates and returns the provider image', async () => {
  const service = createImageGenerationService({ apiKey: 'test', model: 'test-image', client: { interactions: { create: async request => { assert.equal(request.model, 'test-image'); assert.equal(request.response_format[0].type, 'image'); return { output_image: { data: Buffer.from('png-data').toString('base64'), mime_type: 'image/png' } } } } }, logger: { debug: () => {} } })
  const result = await service.generate('a red fox')
  assert.equal(result.mimetype, 'image/png')
  assert.equal(result.buffer.toString(), 'png-data')
})
