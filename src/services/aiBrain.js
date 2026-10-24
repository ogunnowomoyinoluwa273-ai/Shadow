import { GoogleGenAI } from '@google/genai'
import { performance } from 'node:perf_hooks'
import { calculate } from './calculator.js'
import { animeByGenre, popularAnime, randomAnimeQuote, recommendAnime, searchAnime, searchCharacter, searchManga } from './anime.js'
import { define, weather } from './webTools.js'
import { searchImages, downloadImageAsset } from './imageProvider.js'
import { toSticker } from './media.js'
import { sameJid } from '../utils/jid.js'

const DEFAULT_MODEL = 'gemini-3.8-flash'
const MAX_CONTEXT_TURNS = 6
const CONTEXT_TTL_MS = 30 * 60 * 1000
const MAX_TOOL_CALLS = 4
const MAX_OUTPUT_CHARS = 6000
const SHADOW_PATTERN = /^\s*shadow(?:\s*[,;:!?-]\s*(.*)|\s+(.*)|\s*)$/is
const TOOL_REQUEST_PATTERN = /\b(calculate|compute|define|dictionary|weather|anime|manga|recommend|popular|genre|quote|sticker|stickers|image|images|remember|memories|memory|forget|clear)\b/i
const SHADOW_INSTRUCTION = 'You are Shadow, a conversational assistant operating inside WhatsApp. Be natural, concise, and human in ordinary chat: use contractions, short paragraphs, and an occasional playful phrase. Do not sound like a help article, do not use numbered setup instructions unless the user asks for an explanation, and do not explain payloads, handlers, quotedMessage fields, DM mode, or bot architecture unless explicitly asked. If the user asks whether you know you are on WhatsApp, answer plainly that you are chatting with them here on WhatsApp. Adapt your tone when the user asks you to talk normally, and only become detailed when they ask for an explanation. Use only declared tools when they are provided. Never claim an action succeeded unless its tool result says it succeeded. Do not expose secrets or invent unavailable capabilities.'

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

export function createToolRegistry({ reactions = null, sock = null, message = null, memory = null, imageGenerator = null, userKey = '' } = {}) {
  const tools = [
    { name: 'calculate', description: 'Safely evaluate a basic arithmetic expression.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Arithmetic expression.' } }, required: ['expression'] }, execute: async args => jsonResult({ value: calculate(requiredString(args, 'expression', 200)) }) },
    { name: 'remember', description: 'Persist a concise, non-sensitive user preference or fact when the user explicitly asks Shadow to remember it.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The concise fact or preference to save.' } }, required: ['text'] }, execute: async args => { if (!memory) throw new Error('Persistent memory is not configured.'); const record = await memory.remember(userKey, requiredString(args, 'text', 500), { source: 'gemini' }); return jsonResult({ saved: true, memory: record.text, id: record.id }) } },
    { name: 'recall_memories', description: 'Retrieve only this user’s relevant saved memories.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Optional search phrase.' } } }, execute: async args => { if (!memory) throw new Error('Persistent memory is not configured.'); return jsonResult({ memories: memory.recall(userKey, typeof args?.query === 'string' ? args.query : '') }) } },
    { name: 'forget_memory', description: 'Delete one of this user’s saved memories by exact text or id.', parameters: { type: 'object', properties: { id_or_text: { type: 'string' } }, required: ['id_or_text'] }, execute: async args => { if (!memory) throw new Error('Persistent memory is not configured.'); return jsonResult({ deleted: await memory.forget(userKey, requiredString(args, 'id_or_text', 500)) }) } },
    { name: 'clear_memories', description: 'Delete all saved memories belonging to this user only.', parameters: { type: 'object', properties: {} }, execute: async () => { if (!memory) throw new Error('Persistent memory is not configured.'); await memory.clear(userKey); return jsonResult({ cleared: true }) } },
    { name: 'define_word', description: 'Look up an English word definition using the bot dictionary capability.', parameters: { type: 'object', properties: { word: { type: 'string', description: 'English word.' } }, required: ['word'] }, execute: async args => jsonResult({ definition: await define(requiredString(args, 'word', 80)) }) },
    { name: 'weather', description: 'Look up current weather for a city.', parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name.' } }, required: ['city'] }, execute: async args => jsonResult({ weather: await weather(requiredString(args, 'city', 100)) }) },
    { name: 'search_anime', description: 'Search anime titles and return real metadata, synopsis, genres, and scores.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Anime title or search phrase.' } }, required: ['query'] }, execute: async args => jsonResult(await searchAnime(requiredString(args, 'query', 160))) },
    { name: 'search_manga', description: 'Search manga titles and return real metadata, synopsis, genres, and scores.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Manga title or search phrase.' } }, required: ['query'] }, execute: async args => jsonResult(await searchManga(requiredString(args, 'query', 160))) },
    { name: 'search_character', description: 'Search anime characters and return real profiles.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Anime character name.' } }, required: ['query'] }, execute: async args => jsonResult(await searchCharacter(requiredString(args, 'query', 160))) },
    { name: 'recommend_anime', description: 'Recommend anime based on a genre, mood, or title.', parameters: { type: 'object', properties: { preference: { type: 'string', description: 'Genre, mood, or title preference.' } }, required: ['preference'] }, execute: async args => jsonResult({ recommendations: await recommendAnime(requiredString(args, 'preference', 160)) }) },
    { name: 'popular_anime', description: 'Return currently popular anime from the configured anime provider.', parameters: { type: 'object', properties: {} }, execute: async () => jsonResult({ anime: await popularAnime() }) },
    { name: 'anime_by_genre', description: 'Return popular anime from a requested genre.', parameters: { type: 'object', properties: { genre: { type: 'string', description: 'Anime genre.' } }, required: ['genre'] }, execute: async args => jsonResult({ anime: await animeByGenre(requiredString(args, 'genre', 80)) }) },
    { name: 'anime_quote', description: 'Return a short anime-inspired quote.', parameters: { type: 'object', properties: {} }, execute: async () => jsonResult({ quote: randomAnimeQuote() }) }
  ]
  tools.push({ name: 'search_images', description: 'Find accessible anime or character image assets through the approved image provider. Return source links and attribution; do not claim image delivery.', parameters: { type: 'object', properties: { query: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['query'] }, execute: async args => jsonResult({ images: await searchImages(requiredString(args, 'query', 100), { limit: args?.quantity }) }) })
  if (sock && message) tools.push({ name: 'make_image_stickers', description: 'Download approved image results and convert them into static WhatsApp stickers, then send successfully converted stickers. This does not generate new artwork.', parameters: { type: 'object', properties: { image_urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 } }, required: ['image_urls'] }, execute: async args => { const urls = Array.isArray(args?.image_urls) ? args.image_urls.slice(0, 5) : []; if (!urls.length) throw new Error('Provide one to five approved image URLs.'); let sent = 0; for (const url of urls) { const asset = await downloadImageAsset(url); const sticker = await toSticker({ buffer: asset.buffer, type: 'imageMessage' }); await sock.sendMessage(message.key.remoteJid, { sticker }, { quoted: message }); sent += 1 } return jsonResult({ sent, requested: urls.length, note: 'Converted retrieved images into static stickers; no new artwork was generated.' }) } })
  if (imageGenerator?.enabled && sock && message) tools.push({ name: 'generate_image', description: 'Generate one new image from a clear text prompt using the separately configured image provider, then send the actual image to WhatsApp.', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] }, execute: async args => { const result = await imageGenerator.generate(requiredString(args, 'prompt', 1200)); await sock.sendMessage(message.key.remoteJid, { image: result.buffer, mimetype: result.mimetype, caption: 'Generated by Shadow.' }, { quoted: message }); return jsonResult({ sent: true, model: result.model }) } })
  if (reactions && sock && message) tools.push({
    name: 'send_reaction_stickers',
    description: 'Send one to five existing animated reaction stickers. This does not generate new sticker artwork.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'pout', 'hmph'] }, quantity: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['action'] },
    execute: async args => {
      const action = requiredString(args, 'action', 20).toLowerCase()
      if (!['hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite', 'pout', 'hmph'].includes(action)) throw new Error('Unsupported reaction action')
      const assetAction = action === 'hmph' ? 'pout' : action
      const quantity = Math.max(1, Math.min(Number.isInteger(args?.quantity) ? args.quantity : 1, 5))
      for (let i = 0; i < quantity; i++) {
        let sticker
        try { sticker = await reactions.loadSticker(assetAction) } catch { throw new Error(`Existing ${action} sticker assets are unavailable. No new artwork was generated.`) }
        await sock.sendMessage(message.key.remoteJid, { sticker, isAnimated: true }, { quoted: message })
      }
      return jsonResult({ sent: quantity, action, assetAction, note: 'Used existing reaction stickers; no new artwork was generated.' })
    }
  })
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return { tools, byName, declarations: tools.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters })) }
}

export function selectToolsForPrompt(prompt, registry) {
  const value = String(prompt || '').toLowerCase()
  const selected = new Set()
  if (/\b(calculate|calculating|compute|math|sum|multiply|divide|subtract|add)\b/.test(value)) selected.add('calculate')
  if (/\b(define|definition|dictionary|meaning)\b/.test(value)) selected.add('define_word')
  if (/\b(weather|temperature|forecast)\b/.test(value)) selected.add('weather')
  if (/\bmanga\b/.test(value)) selected.add('search_manga')
  else if (/\b(character|waifu)\b/.test(value)) selected.add('search_character')
  else if (/\b(anime|show|series)\b/.test(value)) selected.add(/\b(recommend|suggest|similar|watch)\b/.test(value) ? 'recommend_anime' : 'search_anime')
  if (/\b(recommend|suggest|similar)\b/.test(value) && /\banime\b/.test(value)) selected.add('recommend_anime')
  if (/\b(popular|trending)\b/.test(value) && /\banime\b/.test(value)) selected.add('popular_anime')
  if (/\b(genre|genres)\b/.test(value) && /\banime\b/.test(value)) selected.add('anime_by_genre')
  if (/\b(quote|saying)\b/.test(value) && /\banime\b/.test(value)) selected.add('anime_quote')
  if (/\b(remember|save|preference)\b/.test(value)) selected.add('remember')
  if (/\b(what do you remember|recall|memories|memory)\b/.test(value)) selected.add('recall_memories')
  if (/\b(forget|delete).*\b(memory|memories|preference)\b/.test(value)) selected.add('forget_memory')
  if (/\b(clear|erase).*\b(memory|memories)\b/.test(value)) selected.add('clear_memories')
  if (/\b(image|images|picture|pictures|photos)\b/.test(value)) selected.add('search_images')
  if (/\b(make|turn|convert|create).*\bstickers?\b/.test(value) && !/\b(hmph|hug|slap|kiss|pat|bonk|cry|bite|pout)\b/.test(value)) selected.add('make_image_stickers')
  if (/\b(generate|draw|create)\b/.test(value) && /\b(image|picture|illustration|art)\b/.test(value)) selected.add('generate_image')
  if (/\b(sticker|stickers|hug|slap|kiss|pat|bonk|cry|bite|hmph|pout)\b/.test(value)) selected.add('send_reaction_stickers')
  const declarations = registry.declarations.filter(tool => selected.has(tool.name))
  const byName = new Map(declarations.map(tool => [tool.name, registry.byName.get(tool.name)]))
  return { declarations, byName }
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
  if (/existing .* sticker assets are unavailable|sticker assets are unavailable/i.test(details)) return 'Those existing Hmph stickers are not available right now. I cannot generate new sticker artwork.'
  if (/timeout|timed out|network|fetch|socket|econn/i.test(details)) return 'Gemini did not respond in time. Check the internet connection and try again.'
  return 'Gemini is temporarily unavailable. Check the terminal log for the provider error and try again.'
}
function deepseekFailureMessage(error) { const details = JSON.stringify(providerDetails(error)); if (/401|403|api key|authentication|unauthori[sz]ed|forbidden/i.test(details)) return 'DeepSeek could not authenticate with NVIDIA. Check NVIDIA_API_KEY in your local .env file.'; if (/429|quota|rate limit/i.test(details)) return 'DeepSeek is rate-limited by NVIDIA right now. No provider switch was performed; try again later or switch back to Gemini with .aimodel 1.'; if (/timeout|abort|network|fetch|socket|econn/i.test(details)) return 'DeepSeek did not respond in time. No provider switch was performed.'; return 'DeepSeek is temporarily unavailable through NVIDIA. No provider switch was performed.' }
function rateLimitDurationMs(message) { const match = String(message || '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i); if (!match || !match[0]) return 60_000; return ((Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)) * 1000 + 5_000 }

export function createGeminiBrain({ config, sudo, memory = null, imageGenerator = null, modelRouter = null, context = createContextStore(), client = null, toolFactory = createToolRegistry, logger = console } = {}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const ai = client || (apiKey ? new GoogleGenAI({ apiKey }) : null)
  const model = config?.geminiModel || DEFAULT_MODEL
  const fastModel = config?.geminiFastModel || 'gemini-3.5-flash-lite'
  const thinkingLevel = config?.geminiThinkingLevel || 'low'
  const timeoutMs = config?.geminiTimeoutMs || 20_000
  const toolTimeoutMs = config?.geminiToolTimeoutMs || 60_000
  const toolExecutionTimeoutMs = config?.geminiToolExecutionTimeoutMs || 15_000
  const enabled = Boolean(ai)
  const rateLimitedUntil = new Map()
  const requestNeedsTools = prompt => TOOL_REQUEST_PATTERN.test(prompt)

  async function run({ text: incomingText, message, sock, sender, owner = false, reactions = null }) {
    const prompt = parseShadowAddress(incomingText)
    if (prompt === null) return false
    if (!owner && !sudo?.has?.(sender)) return true
    if (!enabled && modelRouter?.active?.id !== 'deepseek') {
      if (!prompt) {
        await sock.sendMessage(message.key.remoteJid, { text: 'I’m here. What would you like me to help with?' }, { quoted: message })
        return true
      }
      await sock.sendMessage(message.key.remoteJid, { text: 'Gemini is not configured. Add GEMINI_API_KEY to the local environment.' }, { quoted: message })
      return true
    }
    if (prompt && /\b(hmph|hug|slap|kiss|pat|bonk|cry|bite|pout)\b/i.test(prompt) && !reactions) {
      await sock.sendMessage(message.key.remoteJid, { text: 'I can only send existing reaction stickers. The sticker capability is not configured here, and I cannot generate new artwork.' }, { quoted: message })
      return true
    }
    const receivedAt = performance.now()
    try { await sock.sendMessage(message.key.remoteJid, { react: { text: '♠️', key: message.key } }) } catch {}
    const key = `${message.key.remoteJid}:${sender}`
    const history = context.get(key)
    const userPrompt = prompt || 'The user addressed you by saying only “Shadow”. Reply with a short, natural greeting and ask what they need.'
    context.add(key, 'user', userPrompt)
    const wantsTools = requestNeedsTools(prompt)
    const activeDeepSeek = modelRouter?.active?.id === 'deepseek'
    const requestModel = activeDeepSeek ? modelRouter.active.model : (wantsTools ? model : fastModel)
    const requestThinkingLevel = wantsTools ? thinkingLevel : 'minimal'
    const rateLimited = rateLimitedUntil.get(requestModel) || 0
    if (rateLimited > Date.now()) {
      const waitMinutes = Math.max(1, Math.ceil((rateLimited - Date.now()) / 60_000))
      await sock.sendMessage(message.key.remoteJid, { text: `Gemini is rate-limited for this model right now. Try again in about ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.` }, { quoted: message })
      return true
    }
    const baseRegistry = wantsTools ? toolFactory({ reactions, sock, message, memory, imageGenerator, userKey: key }) : { declarations: [], byName: new Map() }
    const registry = wantsTools ? selectToolsForPrompt(prompt, baseRegistry) : baseRegistry
    const conversation = history.length
      ? `${history.map(turn => `${turn.role === 'model' ? 'Shadow' : 'User'}: ${turn.content}`).join('\n')}\nUser: ${userPrompt}`
      : userPrompt
    try {
      logger.debug?.({ model: requestModel, wantsTools, historyTurns: history.length, elapsedMs: Math.round(performance.now() - receivedAt) }, 'Gemini request started')
      if (activeDeepSeek) {
        const answer = await modelRouter.generate({ input: conversation, systemInstruction: SHADOW_INSTRUCTION, timeoutMs })
        context.add(key, 'model', answer)
        await sock.sendMessage(message.key.remoteJid, { text: answer }, { quoted: message })
        logger.debug?.({ model: requestModel, elapsedMs: Math.round(performance.now() - receivedAt) }, 'DeepSeek response delivered')
        return true
      }
      const initialRequest = { model: requestModel, system_instruction: SHADOW_INSTRUCTION, generation_config: { thinking_level: requestThinkingLevel }, input: conversation }
      if (registry.declarations.length) initialRequest.tools = registry.declarations
      let interaction = await withTimeout(ai.interactions.create(initialRequest), wantsTools ? toolTimeoutMs : timeoutMs)
      logger.debug?.({ model: requestModel, elapsedMs: Math.round(performance.now() - receivedAt) }, 'Gemini request completed')
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
          const toolStartedAt = performance.now()
          const result = await withTimeout(tool.execute(object(call.arguments)), toolExecutionTimeoutMs)
          logger.debug?.({ tool: call.name, elapsedMs: Math.round(performance.now() - toolStartedAt) }, 'Gemini tool completed')
          results.push({ type: 'function_result', name: call.name, call_id: call.id, result: JSON.stringify(result).slice(0, MAX_OUTPUT_CHARS) })
        }
        interaction = await withTimeout(ai.interactions.create({ model: requestModel, previous_interaction_id: interaction.id, system_instruction: SHADOW_INSTRUCTION, generation_config: { thinking_level: requestThinkingLevel }, tools: registry.declarations, input: results }), toolTimeoutMs)
      }
      const answer = stepText(interaction) || 'I could not produce a response for that request.'
      context.add(key, 'model', answer)
      await sock.sendMessage(message.key.remoteJid, { text: answer }, { quoted: message })
      logger.debug?.({ elapsedMs: Math.round(performance.now() - receivedAt), wantsTools }, 'Gemini response delivered')
    } catch (error) {
      const details = providerDetails(error)
      if (details.status === '429') rateLimitedUntil.set(requestModel, Date.now() + rateLimitDurationMs(details.message))
      logger.error?.({ provider: details, model: requestModel }, 'Gemini request failed')
      await sock.sendMessage(message.key.remoteJid, { text: activeDeepSeek ? deepseekFailureMessage(error) : geminiFailureMessage(error) }, { quoted: message })
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
