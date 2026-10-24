import { GoogleGenAI } from '@google/genai'
import { calculate } from './calculator.js'
import { animeByGenre, popularAnime, randomAnimeQuote, recommendAnime, searchAnime } from './anime.js'
import { define, weather } from './webTools.js'
import { sameJid } from '../utils/jid.js'

const DEFAULT_MODEL = 'gemini-3.8-flash'
const MAX_CONTEXT_TURNS = 6
const CONTEXT_TTL_MS = 30 * 60 * 1000
const MAX_TOOL_CALLS = 4
const MAX_OUTPUT_CHARS = 6000
const SHADOW_PATTERN = /^\s*shadow(?:\s*[,;:!?-]\s*(.*)|\s+(.*)|\s*)$/is

const text = value => String(value ?? '').slice(0, MAX_OUTPUT_CHARS)
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const requiredString = (args, name, max = 300) => {
  const value = typeof args?.[name] === 'string' ? args[name].trim() : ''
  if (!value || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}
const jsonResult = value => ({ ok: true, result: value })

export function parseShadowAddress(textValue) {
  const match = String(textValue || '').match(SHADOW_PATTERN)
  if (!match) return null
  return (match[1] ?? match[2] ?? '').trim()
}

export function createContextStore({ now = () => Date.now(), ttlMs = CONTEXT_TTL_MS, maxTurns = MAX_CONTEXT_TURNS } = {}) {
  const entries = new Map()
  const get = key => {
    const entry = entries.get(key)
    if (!entry || now() - entry.updatedAt > ttlMs) { entries.delete(key); return [] }
    return entry.turns
  }
  const add = (key, role, content) => {
    const turns = get(key).concat({ role, content: text(content) }).slice(-maxTurns)
    entries.set(key, { turns, updatedAt: now() })
  }
  const clear = key => entries.delete(key)
  return { get, add, clear, size: () => entries.size }
}

export function createToolRegistry({ reactions = null, sock = null, message = null } = {}) {
  const tools = [
    { name: 'calculate', description: 'Safely evaluate a basic arithmetic expression.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Arithmetic expression.' } }, required: ['expression'] }, execute: async args => jsonResult({ value: calculate(requiredString(args, 'expression', 200)) }) },
    { name: 'define_word', description: 'Look up an English word definition using the bot dictionary capability.', parameters: { type: 'object', properties: { word: { type: 'string', description: 'English word.' } }, required: ['word'] }, execute: async args => jsonResult({ definition: await define(requiredString(args, 'word', 80)) }) },
    { name: 'weather', description: 'Look up current weather for a city.', parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name.' } }, required: ['city'] }, execute: async args => jsonResult({ weather: await weather(requiredString(args, 'city', 100)) }) },
    { name: 'search_anime', description: 'Search anime titles and return real metadata, synopsis, genres, and scores.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Anime title or search phrase.' } }, required: ['query'] }, execute: async args => jsonResult(await searchAnime(requiredString(args, 'query', 160))) },
    { name: 'recommend_anime', description: 'Recommend anime based on a genre, mood, or title.', parameters: { type: 'object', properties: { preference: { type: 'string', description: 'Genre, mood, or title preference.' } }, required: ['preference'] }, execute: async args => jsonResult({ recommendations: await recommendAnime(requiredString(args, 'preference', 160)) }) },
    { name: 'popular_anime', description: 'Return currently popular anime from the configured anime provider.', parameters: { type: 'object', properties: {} }, execute: async () => jsonResult({ anime: await popularAnime() }) },
    { name: 'anime_by_genre', description: 'Return popular anime from a requested genre.', parameters: { type: 'object', properties: { genre: { type: 'string', description: 'Anime genre.' } }, required: ['genre'] }, execute: async args => jsonResult({ anime: await animeByGenre(requiredString(args, 'genre', 80)) }) },
    { name: 'anime_quote', description: 'Return a short anime-inspired quote.', parameters: { type: 'object', properties: {} }, execute: async () => jsonResult({ quote: randomAnimeQuote() }) }
  ]
  if (reactions && sock && message) tools.push({
    name: 'send_reaction_stickers',
    description: 'Send one to five existing animated reaction stickers. This does not generate new sticker artwork.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'pout'] }, quantity: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['action'] },
    execute: async args => {
      const action = requiredString(args, 'action', 20).toLowerCase()
      if (!['hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'pout'].includes(action)) throw new Error('Unsupported reaction action')
      const quantity = Math.max(1, Math.min(Number.isInteger(args?.quantity) ? args.quantity : 1, 5))
      for (let i = 0; i < quantity; i++) {
        const sticker = await reactions.loadSticker(action)
        await sock.sendMessage(message.key.remoteJid, { sticker, isAnimated: true }, { quoted: message })
      }
      return jsonResult({ sent: quantity, action, note: 'Used existing reaction stickers; no new artwork was generated.' })
    }
  })
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return { tools, byName, declarations: tools.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters })) }
}

function stepCalls(interaction) {
  return (interaction?.outputs || interaction?.steps || []).filter(step => step?.type === 'function_call')
}
function stepText(interaction) {
  const outputs = interaction?.outputs || interaction?.steps || []
  return text(interaction?.output_text || interaction?.text || outputs.filter(step => step?.type === 'text').map(step => step.text).join('\n') || outputs.filter(step => step?.type === 'message').map(step => step.content || step.text).join('\n'))
}
function providerDetails(error) {
  const nested = error?.error?.error || error?.error || error?.response?.data?.error || error?.response?.error
  const status = error?.status || error?.statusCode || nested?.code || nested?.status || ''
  const message = nested?.message || error?.message || String(nested || error || '')
  const code = nested?.status || nested?.reason || error?.code || ''
  return { status: String(status || ''), code: String(code || ''), message: String(message || '').slice(0, 2000) }
}
function geminiFailureMessage(error) {
  const details = JSON.stringify(providerDetails(error))
  if (/401|403|api key|authentication|permission|unauthori[sz]ed|forbidden/i.test(details)) return 'Gemini rejected the API key or its permissions. Check GEMINI_API_KEY in your local .env file and create a fresh key if necessary.'
  if (/404|model|not found|unsupported/i.test(details)) return 'Gemini could not find the configured model. Check GEMINI_MODEL in your local .env file.'
  if (/429|quota|resource exhausted|rate limit/i.test(details)) return 'Gemini is temporarily rate-limited or the API quota is exhausted. Please try again later.'
  if (/timeout|timed out|network|fetch|socket|econn/i.test(details)) return 'Gemini did not respond in time. Check the internet connection and try again.'
  return 'Gemini is temporarily unavailable. Check the terminal log for the provider error and try again.'
}

export function createGeminiBrain({ config, sudo, context = createContextStore(), client = null, toolFactory = createToolRegistry, logger = console } = {}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const ai = client || (apiKey ? new GoogleGenAI({ apiKey }) : null)
  const model = config?.geminiModel || DEFAULT_MODEL
  const thinkingLevel = config?.geminiThinkingLevel || 'low'
  const timeoutMs = config?.geminiTimeoutMs || 20_000
  const enabled = Boolean(ai)

  async function run({ text: incomingText, message, sock, sender, owner = false, reactions = null }) {
    const prompt = parseShadowAddress(incomingText)
    if (prompt === null) return false
    if (!owner && !sudo?.has?.(sender)) return true
    if (!prompt) {
      await sock.sendMessage(message.key.remoteJid, { text: 'I’m here. What would you like me to help with?' }, { quoted: message })
      return true
    }
    if (!enabled) {
      await sock.sendMessage(message.key.remoteJid, { text: 'Gemini is not configured. Add GEMINI_API_KEY to the local environment.' }, { quoted: message })
      return true
    }
    try { await sock.sendMessage(message.key.remoteJid, { react: { text: '♠️', key: message.key } }) } catch {}
    const key = `${message.key.remoteJid}:${sender}`
    const history = context.get(key)
    context.add(key, 'user', prompt)
    const registry = toolFactory({ reactions, sock, message })
    const conversation = history.length
      ? `${history.map(turn => `${turn.role === 'model' ? 'Shadow' : 'User'}: ${turn.content}`).join('\n')}\nUser: ${prompt}`
      : prompt
    try {
      let interaction = await withTimeout(ai.interactions.create({ model, system_instruction: 'You are Shadow, a WhatsApp assistant. Use only declared tools. Never claim an action succeeded unless its tool result says it succeeded. Do not expose secrets. Ask one concise clarifying question when required information is missing. Existing reaction stickers are not newly generated artwork.', generation_config: { thinking_level: thinkingLevel }, input: conversation, tools: registry.declarations }), timeoutMs)
      let calls = 0
      while (true) {
        const pending = stepCalls(interaction)
        if (!pending.length) break
        const results = []
        for (const call of pending) {
          calls += 1
          if (calls > MAX_TOOL_CALLS) throw new Error('Tool-call limit exceeded')
          const tool = registry.byName.get(call.name)
          if (!tool) throw new Error('Unknown tool requested')
          const result = await tool.execute(object(call.arguments))
          results.push({ type: 'function_result', name: call.name, call_id: call.id, result: JSON.stringify(result).slice(0, MAX_OUTPUT_CHARS) })
        }
        interaction = await withTimeout(ai.interactions.create({ model, previous_interaction_id: interaction.id, system_instruction: 'You are Shadow, a WhatsApp assistant. Use only declared tools. Never claim an action succeeded unless its tool result says it succeeded. Do not expose secrets. Ask one concise clarifying question when required information is missing. Existing reaction stickers are not newly generated artwork.', generation_config: { thinking_level: thinkingLevel }, tools: registry.declarations, input: results }), timeoutMs)
      }
      const answer = stepText(interaction) || 'I could not produce a response for that request.'
      context.add(key, 'model', answer)
      await sock.sendMessage(message.key.remoteJid, { text: answer }, { quoted: message })
    } catch (error) {
      logger.error?.({ provider: providerDetails(error), model }, 'Gemini request failed')
      await sock.sendMessage(message.key.remoteJid, { text: geminiFailureMessage(error) }, { quoted: message })
    } finally {
      try { await sock.sendMessage(message.key.remoteJid, { react: { text: '', key: message.key } }) } catch {}
    }
    return true
  }
  return { enabled, model, run, context, parseShadowAddress }
}

async function withTimeout(promise, ms) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Gemini request timed out')), ms) })]) } finally { clearTimeout(timer) }
}

export const isSameIdentity = sameJid
