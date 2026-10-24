import { searchAnime, searchCharacter } from './anime.js'
import { UserFacingError } from '../utils/errors.js'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_HOSTS = [/\.anilist\.co$/i, /\.jikan\.moe$/i, /\.myanimelist\.net$/i, /\.nekos\.best$/i]
const validHttps = value => { try { const url = new URL(value); if (url.protocol !== 'https:') return null; if (!ALLOWED_HOSTS.some(pattern => pattern.test(url.hostname))) return null; return url } catch { return null } }

export async function searchImages(query, { limit = 5 } = {}) {
  const value = String(query || '').trim().slice(0, 100)
  if (value.length < 2) throw new UserFacingError('Provide at least two characters for image search.')
  const seen = new Set(); const results = []
  const add = item => { const url = validHttps(item?.imageUrl); if (!url || seen.has(url.href)) return; seen.add(url.href); results.push({ imageUrl: url.href, sourceUrl: item.url || item.source || null, title: item.title || item.name || value }) }
  try { const anime = await searchAnime(value); for (const item of anime.results || []) add(item) } catch {}
  if (results.length < limit) try { const characters = await searchCharacter(value); for (const item of characters.results || []) add(item) } catch {}
  return results.slice(0, Math.max(1, Math.min(Number(limit) || 5, 5)))
}

export async function downloadImageAsset(imageUrl, { timeoutMs = 8000, maxBytes = MAX_BYTES, fetchImpl = fetch } = {}) {
  const url = validHttps(imageUrl)
  if (!url) throw new UserFacingError('The image source is not an approved HTTPS image provider.')
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Shadow WhatsApp bot', accept: 'image/*' } })
  if (!response.ok) throw new UserFacingError('The image provider did not return the requested image.')
  const type = response.headers.get('content-type') || ''
  if (!type.startsWith('image/')) throw new UserFacingError('The provider returned a non-image file.')
  const length = Number(response.headers.get('content-length') || 0)
  if (length > maxBytes) throw new UserFacingError('The image is too large to process safely.')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > maxBytes) throw new UserFacingError('The image is empty or too large to process safely.')
  return { buffer, mimetype: type, sourceUrl: url.href }
}
