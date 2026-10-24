import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { resolveFfmpeg } from './media.js'
import { logger } from '../utils/logger.js'

const exec = promisify(execFile)
const API_ROOT = 'https://animegifs-enkidu.koyeb.app/v3'
const API_HOST = 'animegifs-enkidu.koyeb.app'
const GIF_HOST = 'frqs54dqeajn.objectstorage.eu-frankfurt-1.oci.customer-oci.com'
export const REACTION_ACTIONS = Object.freeze(['hug', 'slap', 'kiss', 'pat', 'bonk', 'cry', 'bite'])
const ACTION_SET = new Set([...REACTION_ACTIONS, 'pout'])
const USER_AGENT = 'SHADOW-WhatsApp-Bot/1.0'
const MAX_JSON_BYTES = 64 * 1024
const MAX_GIF_BYTES = 12 * 1024 * 1024
export const MAX_REACTION_STICKER_BYTES = 500_000
export const MAX_REACTION_STICKER_DURATION_MS = 10_000
const API_TIMEOUT_MS = 10_000
const GIF_TIMEOUT_MS = 15_000
const FFMPEG_TIMEOUT_MS = 20_000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 32
const CACHE_MAX_BYTES = 8 * 1024 * 1024
const STICKER_PROFILES = Object.freeze([
  { fps: 15, quality: 55, contentSize: 512, seconds: 8 },
  { fps: 12, quality: 42, contentSize: 448, seconds: 8 },
  { fps: 10, quality: 30, contentSize: 384, seconds: 6 }
])

function reactionError(message, code) { return Object.assign(new Error(message), { code }) }
function validateAction(action) {
  const value = String(action || '').toLowerCase()
  if (!ACTION_SET.has(value)) throw reactionError('Unsupported reaction sticker action.', 'SHADOW_REACTION_ACTION')
  return value
}
function validateGifUrl(value) {
  let url
  try { url = new URL(value) } catch { throw reactionError('Reaction GIF provider returned an invalid media URL.', 'SHADOW_REACTION_URL') }
  if (url.protocol !== 'https:' || url.hostname !== GIF_HOST || url.port || url.username || url.password || !url.pathname.toLowerCase().endsWith('.gif')) {
    throw reactionError('Reaction GIF provider returned an untrusted media URL.', 'SHADOW_REACTION_URL')
  }
  return url
}
async function readLimited(response, maxBytes) {
  const declaredSize = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw reactionError('Reaction GIF exceeds the safe download-size limit.', 'SHADOW_REACTION_SIZE')
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        size += chunk.length
        if (size > maxBytes) {
          await reader.cancel().catch(() => {})
          throw reactionError('Reaction GIF exceeds the safe download-size limit.', 'SHADOW_REACTION_SIZE')
        }
        chunks.push(chunk)
      }
    } finally { reader.releaseLock?.() }
    return Buffer.concat(chunks, size)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) throw reactionError('Reaction GIF exceeds the safe download-size limit.', 'SHADOW_REACTION_SIZE')
  return buffer
}
function isGif(buffer) { return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)) }

function readWebpAnimation(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null
  const riffEnd = buffer.readUInt32LE(4) + 8
  if (riffEnd !== buffer.length || riffEnd < 12) return null
  let canvasWidth = 0
  let canvasHeight = 0
  let animated = false
  let hasAnimationChunk = false
  let totalDurationMs = 0
  let frames = 0
  let offset = 12
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) return null
    const type = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const payload = offset + 8
    const end = payload + size
    if (end > riffEnd) return null
    if (type === 'VP8X' && size >= 10) {
      const flags = buffer[payload]
      animated = (flags & 0x02) !== 0
      canvasWidth = 1 + buffer.readUIntLE(payload + 4, 3)
      canvasHeight = 1 + buffer.readUIntLE(payload + 7, 3)
    } else if (type === 'ANIM') {
      hasAnimationChunk = size >= 6
    } else if (type === 'ANMF') {
      if (size < 24) return null
      let nestedOffset = payload + 16
      let hasImageChunk = false
      while (nestedOffset + 8 <= end) {
        const nestedType = buffer.toString('ascii', nestedOffset, nestedOffset + 4)
        const nestedSize = buffer.readUInt32LE(nestedOffset + 4)
        const nestedEnd = nestedOffset + 8 + nestedSize
        if (nestedEnd > end) return null
        if (['VP8 ', 'VP8L'].includes(nestedType) && nestedSize > 0) hasImageChunk = true
        nestedOffset = nestedEnd + (nestedSize & 1)
      }
      if (nestedOffset !== end || !hasImageChunk) return null
      totalDurationMs += buffer.readUIntLE(payload + 12, 3)
      frames += 1
    }
    offset = end + (size & 1)
  }
  if (offset !== riffEnd || canvasWidth !== 512 || canvasHeight !== 512 || !animated || !hasAnimationChunk || frames < 2 || totalDurationMs <= 0 || totalDurationMs > MAX_REACTION_STICKER_DURATION_MS) return null
  return { width: canvasWidth, height: canvasHeight, frames, durationMs: totalDurationMs }
}

function stickerArgs(input, output, profile) {
  const filter = `fps=${profile.fps},scale=w='min(${profile.contentSize},iw)':h='min(${profile.contentSize},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=yuva420p`
  return [
    '-y', '-i', input, '-t', String(profile.seconds), '-vf', filter, '-an',
    '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', String(profile.quality), '-preset', 'icon',
    '-loop', '0', '-f', 'webp', output
  ]
}

export function createReactionService({
  fetchImpl = globalThis.fetch,
  execRunner = exec,
  ffmpegResolver = resolveFfmpeg,
  tempDirectory = os.tmpdir(),
  apiTimeoutMs = API_TIMEOUT_MS,
  gifTimeoutMs = GIF_TIMEOUT_MS,
  ffmpegTimeoutMs = FFMPEG_TIMEOUT_MS,
  maxGifBytes = MAX_GIF_BYTES,
  maxStickerBytes = MAX_REACTION_STICKER_BYTES,
  cacheTtlMs = CACHE_TTL_MS,
  cacheMaxEntries = CACHE_MAX_ENTRIES,
  cacheMaxBytes = CACHE_MAX_BYTES,
  clock = Date.now,
  log = logger
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for reaction stickers.')
  const stickerLimit = Math.min(MAX_REACTION_STICKER_BYTES, Math.max(1, Number(maxStickerBytes) || MAX_REACTION_STICKER_BYTES))
  const cache = new Map()
  const inFlight = new Map()
  let cachedBytes = 0

  const request = async (url, { expectedHost, accept, timeoutMs, maxBytes, parseJson = false }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept },
        signal: controller.signal
      })
      const finalUrl = response.url ? new URL(response.url) : new URL(url)
      if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== expectedHost || finalUrl.port || finalUrl.username || finalUrl.password) throw reactionError('Reaction GIF request resolved to an untrusted host.', 'SHADOW_REACTION_URL')
      if (!response.ok) throw reactionError(`Reaction GIF provider returned HTTP ${response.status}.`, 'SHADOW_REACTION_PROVIDER')
      if (parseJson) {
        const bytes = await readLimited(response, maxBytes)
        try { return JSON.parse(bytes.toString('utf8')) } catch { throw reactionError('Reaction GIF provider returned invalid JSON.', 'SHADOW_REACTION_RESPONSE') }
      }
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
      if (contentType && !contentType.startsWith('image/gif')) throw reactionError('Reaction GIF provider returned a non-GIF file.', 'SHADOW_REACTION_RESPONSE')
      return readLimited(response, maxBytes)
    } catch (error) {
      if (error.name === 'AbortError') throw reactionError('Reaction GIF request timed out. Try again shortly.', 'SHADOW_REACTION_TIMEOUT')
      throw error
    } finally { clearTimeout(timer) }
  }

  function cachedSticker(key) {
    const entry = cache.get(key)
    if (!entry) return null
    if (entry.expiresAt <= clock()) { cache.delete(key); cachedBytes -= entry.buffer.length; return null }
    cache.delete(key)
    cache.set(key, entry)
    return Buffer.from(entry.buffer)
  }

  function cacheSticker(key, buffer) {
    if (!cacheMaxEntries || !cacheMaxBytes || buffer.length > cacheMaxBytes) return
    const previous = cache.get(key)
    if (previous) { cachedBytes -= previous.buffer.length; cache.delete(key) }
    const entry = { buffer: Buffer.from(buffer), expiresAt: clock() + cacheTtlMs }
    cache.set(key, entry)
    cachedBytes += entry.buffer.length
    while (cache.size > cacheMaxEntries || cachedBytes > cacheMaxBytes) {
      const oldest = cache.keys().next().value
      const removed = cache.get(oldest)
      cache.delete(oldest)
      cachedBytes -= removed.buffer.length
    }
  }

  async function convertGifToSticker(gifUrl, action) {
    const startedAt = performance.now()
    let tempDir
    try {
      const gif = await request(gifUrl, { expectedHost: GIF_HOST, accept: 'image/gif', timeoutMs: gifTimeoutMs, maxBytes: maxGifBytes })
      if (!isGif(gif)) throw reactionError('Reaction GIF provider returned invalid GIF data.', 'SHADOW_REACTION_RESPONSE')
      tempDir = await fs.mkdtemp(path.join(tempDirectory, 'shadow-reaction-sticker-'))
      const input = path.join(tempDir, 'reaction.gif')
      await fs.writeFile(input, gif, { mode: 0o600 })
      const ffmpeg = await ffmpegResolver()
      let oversized = false
      for (let index = 0; index < STICKER_PROFILES.length; index += 1) {
        const output = path.join(tempDir, `reaction-${index}.webp`)
        try {
          await execRunner(ffmpeg, stickerArgs(input, output, STICKER_PROFILES[index]), { windowsHide: true, timeout: ffmpegTimeoutMs, maxBuffer: 2 * 1024 * 1024 })
        } catch {
          throw reactionError('Could not convert this reaction GIF into an animated WhatsApp sticker.', 'SHADOW_REACTION_CONVERT')
        }
        const { size } = await fs.stat(output)
        if (size > stickerLimit) { oversized = true; continue }
        const webp = await fs.readFile(output)
        const animation = readWebpAnimation(webp)
        if (!animation) throw reactionError('Reaction conversion did not produce a valid animated 512×512 WebP sticker.', 'SHADOW_REACTION_CONVERT')
        log?.info?.({ action, durationMs: Math.round(performance.now() - startedAt), inputBytes: gif.length, outputBytes: webp.length, frames: animation.frames, animationMs: animation.durationMs }, 'Animated reaction sticker prepared')
        return webp
      }
      if (oversized) throw reactionError('The optimized reaction sticker exceeds WhatsApp’s 500 KB size limit.', 'SHADOW_REACTION_SIZE')
      throw reactionError('Could not create a valid animated reaction sticker.', 'SHADOW_REACTION_CONVERT')
    } finally {
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function loadSticker(action) {
    const category = validateAction(action)
    const startedAt = performance.now()
    try {
      const apiUrl = new URL(`${API_ROOT}/api/`)
      apiUrl.searchParams.set('category', category)
      const data = await request(apiUrl, { expectedHost: API_HOST, accept: 'application/json', timeoutMs: apiTimeoutMs, maxBytes: MAX_JSON_BYTES, parseJson: true })
      const gifUrl = validateGifUrl(data?.gif)
      const key = gifUrl.href
      const cached = cachedSticker(key)
      if (cached) {
        log?.info?.({ action: category, durationMs: Math.round(performance.now() - startedAt), outputBytes: cached.length, cacheHit: true }, 'Animated reaction sticker cache hit')
        return cached
      }
      let pending = inFlight.get(key)
      if (!pending) {
        pending = convertGifToSticker(gifUrl, category)
        inFlight.set(key, pending)
      }
      try {
        const sticker = await pending
        cacheSticker(key, sticker)
        return Buffer.from(sticker)
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key)
      }
    } catch (error) {
      const known = typeof error.code === 'string' && error.code.startsWith('SHADOW_REACTION_')
      const ffmpegMissing = String(error.message || '').startsWith('FFmpeg was not found')
      log?.warn?.({ action: category, durationMs: Math.round(performance.now() - startedAt), category: error.code || (ffmpegMissing ? 'ffmpeg_missing' : error.name || 'provider') }, 'Reaction sticker request failed')
      if (known || ffmpegMissing) throw error
      throw reactionError('Reaction sticker service is temporarily unavailable. Try again shortly.', 'SHADOW_REACTION_PROVIDER')
    }
  }

  return { loadSticker }
}
