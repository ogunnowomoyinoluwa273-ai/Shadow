import { GoogleGenAI } from '@google/genai'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const cleanPrompt = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
function withTimeout(promise, timeoutMs) { let timer; const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image generation timed out')), timeoutMs) }); return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) }

export function createImageGenerationService({ apiKey = process.env.IMAGE_API_KEY?.trim(), model = 'gemini-nano-banana-2.1', timeoutMs = 45_000, client = null, logger = console } = {}) {
  const ai = client || (apiKey ? new GoogleGenAI({ apiKey }) : null)
  return {
    enabled: Boolean(ai),
    async generate(prompt) {
      const input = cleanPrompt(prompt)
      if (!input) throw new Error('Image prompt cannot be empty.')
      if (!ai) throw new Error('Image generation is not configured. Set IMAGE_API_KEY to enable it.')
      const started = performance.now()
      const interaction = await withTimeout(ai.interactions.create({ model, input, response_format: [{ type: 'image', mime_type: 'image/png', aspect_ratio: '1:1' }] }), timeoutMs)
      const block = interaction?.output_image || (interaction?.steps || []).flatMap(step => step?.content || []).find(item => item?.type === 'image')
      const data = block?.data
      if (!data) throw new Error('The image provider returned no image.')
      const buffer = Buffer.from(data, 'base64')
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('The generated image was empty or too large.')
      logger.debug?.({ provider: 'gemini-image', model, durationMs: Math.round(performance.now() - started), bytes: buffer.length }, 'Image generation completed')
      return { buffer, mimetype: block?.mime_type || 'image/png', model }
    }
  }
}
