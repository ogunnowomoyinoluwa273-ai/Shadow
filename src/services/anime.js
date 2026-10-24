import { performance } from 'node:perf_hooks'
import { logger } from '../utils/logger.js'
import { UserFacingError } from '../utils/errors.js'

const JIKAN = 'https://api.jikan.moe/v4'
const ANILIST = 'https://graphql.anilist.co'
const IMAGE_API = 'https://nekos.best/api/v2/neko'
const THEMES_API = 'https://api.animethemes.moe/search/'
const cache = new Map()
const now = () => Date.now()
const clean = (value, max = 500) => String(value || '').replace(/<[^>]*>/g, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
const httpsUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null } catch { return null } }
const providerError = (message, category = 'provider') => Object.assign(new UserFacingError(message), { category })

async function requestJson(url, options = {}, operation = 'anime provider', timeoutMs = 5000) {
  const started = performance.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, headers: { 'user-agent': 'Shadow WhatsApp bot', ...(options.headers || {}) }, signal: controller.signal })
    const durationMs = Math.round(performance.now() - started)
    logger.info({ operation, durationMs, status: response.status }, 'Anime provider request completed')
    if (!response.ok) throw providerError(response.status === 429 ? 'Anime service is rate-limited. Try again shortly.' : 'Anime service is temporarily unavailable. Try again shortly.', response.status === 429 ? 'rate_limit' : 'http')
    try { return await response.json() } catch { throw providerError('Anime service returned invalid data.', 'parse') }
  } catch (error) {
    const durationMs = Math.round(performance.now() - started)
    if (error.category) { logger.warn({ operation, durationMs, category: error.category }, 'Anime provider request failed'); throw error }
    const category = error.name === 'AbortError' ? 'timeout' : 'network'
    logger.warn({ operation, durationMs, category }, 'Anime provider request failed')
    throw providerError(category === 'timeout' ? 'Anime provider timed out. Try again shortly.' : 'Anime provider is unreachable. Try again shortly.', category)
  } finally { clearTimeout(timer) }
}
async function graphql(query, variables, operation) {
  const data = await requestJson(ANILIST, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) }, operation, 5000)
  if (data.errors?.length) throw providerError('Anime provider returned a query error.', 'graphql')
  return data.data
}
async function cached(key, loader, ttl = 60_000) {
  const hit = cache.get(key); if (hit && hit.expiresAt > now()) return hit.value
  const value = await loader(); cache.set(key, { value, expiresAt: now() + ttl }); if (cache.size > 100) cache.delete(cache.keys().next().value); return value
}
function normalizeAnime(item, provider = 'jikan') {
  const title = provider === 'anilist' ? item.title?.english || item.title?.romaji || item.title?.native : item.title_english || item.title || item.title_japanese
  return { id: String(item.mal_id || item.id || ''), title: clean(title, 120), alternatives: provider === 'anilist' ? [item.title?.romaji, item.title?.native, item.title?.english] : [item.title, item.title_english, item.title_japanese], synopsis: clean(provider === 'anilist' ? item.description : item.synopsis, 700), year: provider === 'anilist' ? item.seasonYear || null : item.year || item.aired?.prop?.from?.year || null, genres: (item.genres || []).map(g => clean(typeof g === 'string' ? g : g.name, 40)).filter(Boolean).slice(0, 8), episodes: Number.isFinite(item.episodes) ? item.episodes : null, score: Number.isFinite(item.score) ? item.score : Number.isFinite(item.averageScore) ? Math.round(item.averageScore / 10 * 10) / 10 : null, status: clean(item.status, 80), type: clean(provider === 'anilist' ? item.format : item.type, 40), imageUrl: httpsUrl(provider === 'anilist' ? item.coverImage?.large : item.images?.jpg?.large_image_url || item.images?.jpg?.image_url), url: httpsUrl(provider === 'anilist' ? item.siteUrl : item.url) }
}
const animeQuery = `query ($search: String, $season: MediaSeason, $year: Int) { Page(page: 1, perPage: 5) { media(search: $search, season: $season, seasonYear: $year, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) { id title { romaji english native } format status episodes averageScore genres season seasonYear description(asHtml: false) coverImage { large } siteUrl } } }`
const anilistSearch = async q => { const data = await graphql(animeQuery, { search: q }, 'anilist anime search'); return { provider: 'anilist', results: (data?.Page?.media || []).map(item => normalizeAnime(item, 'anilist')).filter(item => item.id && item.title) } }
const jikanSearch = async q => { const data = await requestJson(`${JIKAN}/anime?q=${encodeURIComponent(q)}&limit=5&sfw=true&order_by=score&sort=desc`, {}, 'jikan anime fallback', 2500); return { provider: 'jikan', results: (data.data || []).map(item => normalizeAnime(item)).filter(item => item.id && item.title) } }
export async function searchAnime(query) {
  const q = clean(query, 80); if (q.length < 2) throw new UserFacingError('Usage: .anime title')
  return cached(`anime:${q.toLowerCase()}`, async () => { try { return await anilistSearch(q) } catch (primary) { try { return await jikanSearch(q) } catch { throw new UserFacingError(primary.category === 'rate_limit' ? primary.message : 'Anime search is temporarily unavailable. Try again later.') } } })
}
const mangaQuery = `query ($search: String) { Page(page: 1, perPage: 5) { media(search: $search, type: MANGA, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) { id title { romaji english native } format status chapters averageScore genres startDate { year } description(asHtml: false) coverImage { large } siteUrl } } }`
function normalizeManga(item) { return { id: String(item.id || ''), title: clean(item.title?.english || item.title?.romaji || item.title?.native, 120), format: clean(item.format, 40), status: clean(item.status, 80), chapters: Number.isFinite(item.chapters) ? item.chapters : null, score: Number.isFinite(item.averageScore) ? Math.round(item.averageScore / 10 * 10) / 10 : null, year: item.startDate?.year || null, genres: (item.genres || []).map(g => clean(g, 40)).filter(Boolean).slice(0, 8), synopsis: clean(item.description, 700), imageUrl: httpsUrl(item.coverImage?.large), url: httpsUrl(item.siteUrl) } }
export async function searchManga(query) { const q = clean(query, 80); if (q.length < 2) throw new UserFacingError('Usage: .manga title'); return cached(`manga:${q.toLowerCase()}`, async () => { const data = await graphql(mangaQuery, { search: q }, 'anilist manga search'); return (data?.Page?.media || []).map(normalizeManga).filter(item => item.id && item.title) }) }
const genreQuery = `query ($genre: String) { Page(page: 1, perPage: 8) { media(genre: $genre, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { id title { romaji english native } format status episodes averageScore genres seasonYear description(asHtml: false) coverImage { large } siteUrl } } }`
export async function animeByGenre(genre) { const value = clean(genre, 40); if (!value) throw new UserFacingError('Usage: .animegenre genre'); const data = await graphql(genreQuery, { genre: value }, 'anilist anime genre'); return (data?.Page?.media || []).map(item => normalizeAnime(item, 'anilist')).filter(item => item.id && item.title) }
const popularQuery = `query { Page(page: 1, perPage: 8) { media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) { id title { romaji english native } format status episodes averageScore genres seasonYear description(asHtml: false) coverImage { large } siteUrl } } }`
export async function popularAnime() { const data = await graphql(popularQuery, {}, 'anilist popular anime'); return (data?.Page?.media || []).map(item => normalizeAnime(item, 'anilist')).filter(item => item.id && item.title) }
const seasonName = month => month <= 2 || month === 12 ? 'WINTER' : month <= 5 ? 'SPRING' : month <= 8 ? 'SUMMER' : 'FALL'
export async function seasonalAnime(page = 1) {
  const safePage = Math.max(1, Math.min(Number(page) || 1, 5)); const date = new Date(); const season = seasonName(date.getUTCMonth() + 1); const year = date.getUTCFullYear()
  return cached(`seasonal:${season}:${year}:${safePage}`, async () => { try { const data = await graphql(`query ($season: MediaSeason, $year: Int, $page: Int) { Page(page: $page, perPage: 10) { media(season: $season, seasonYear: $year, type: ANIME, isAdult: false, sort: POPULARITY_DESC) { id title { romaji english native } format status episodes averageScore genres season seasonYear description(asHtml: false) coverImage { large } siteUrl } } }`, { season, year, page: safePage }, 'anilist seasonal'); return { provider: 'anilist', results: (data?.Page?.media || []).map(item => normalizeAnime(item, 'anilist')).filter(item => item.id && item.title) } } catch { const data = await requestJson(`${JIKAN}/seasons/now?page=${safePage}`, {}, 'jikan seasonal fallback', 2500); return { provider: 'jikan', results: (data.data || []).slice(0, 10).map(item => normalizeAnime(item)) } } }, 120_000)
}
function normalizeCharacter(item, provider = 'jikan') { return { id: String(item.mal_id || item.id || ''), name: clean(provider === 'anilist' ? item.name?.full : item.name, 100), about: clean(provider === 'anilist' ? item.description : item.about, 700), imageUrl: httpsUrl(provider === 'anilist' ? item.image?.large : item.images?.jpg?.image_url || item.images?.jpg?.large_image_url), url: httpsUrl(provider === 'anilist' ? item.siteUrl : item.url), favorites: Number.isFinite(item.favorites) ? item.favorites : null, anime: provider === 'anilist' ? (item.media?.nodes || []).slice(0, 5).map(x => clean(x.title?.romaji || x.title?.english, 100)).filter(Boolean) : (item.anime || []).slice(0, 5).map(x => clean(x.name, 100)).filter(Boolean) } }
const characterQuery = `query ($search: String) { Page(page: 1, perPage: 5) { characters(search: $search) { id name { full native } description image { large } siteUrl media(perPage: 5) { nodes { title { romaji english } } } } } }`
export async function searchCharacter(query) { const q = clean(query, 80); if (q.length < 2) throw new UserFacingError('Usage: .character name'); return cached(`character:${q.toLowerCase()}`, async () => { try { const data = await graphql(characterQuery, { search: q }, 'anilist character search'); return { provider: 'anilist', results: (data?.Page?.characters || []).map(item => normalizeCharacter(item, 'anilist')).filter(item => item.id && item.name) } } catch { try { const data = await requestJson(`${JIKAN}/characters?q=${encodeURIComponent(q)}&limit=5`, {}, 'jikan character fallback', 2500); return { provider: 'jikan', results: (data.data || []).map(item => normalizeCharacter(item)).filter(item => item.id && item.name) } } catch { throw new UserFacingError('Character search is temporarily unavailable. Try again later.') } } }) }
export async function characterById(id) { const data = await requestJson(`${JIKAN}/characters/${encodeURIComponent(id)}/full`, {}, 'jikan character detail', 2500); return normalizeCharacter(data.data || {}) }
export async function animeThemes(query) {
  const q = clean(query, 80)
  if (q.length < 2) throw new UserFacingError('Usage: .animesong anime title')
  const searchUrl = `https://animethemes.moe/search?q=${encodeURIComponent(q)}`
  const fallback = [{ title: `Search anime themes for ${q}`, type: 'Theme search', url: searchUrl }]

  let data
  try {
    const endpoint = new URL(THEMES_API)
    endpoint.searchParams.set('q', q)
    endpoint.searchParams.set('page[limit]', '10')
    data = await requestJson(endpoint.toString(), {}, 'animethemes search', 5000)
  } catch (error) {
    logger.warn({ operation: 'animethemes search fallback', category: error.category || 'provider' }, 'Returning direct AnimeThemes search link')
    return fallback
  }

  const search = data?.search || {}
  const videos = Array.isArray(search.videos) ? search.videos : []
  const themes = Array.isArray(search.animethemes) ? search.animethemes : []
  const fromVideos = videos.map((video, index) => {
    const filename = clean(video.filename || video.basename || `Theme ${index + 1}`, 160)
    const match = filename.match(/(?:^|[-_])(OP|ED)(?:[-_]?)(\d*)/i)
    const sequence = match?.[2] || themes[index]?.sequence || null
    return { title: filename, type: match?.[1]?.toUpperCase() === 'ED' ? 'Ending' : 'Opening', ...(sequence ? { sequence } : {}), url: httpsUrl(video.link) }
  }).filter(item => item.url)
  if (fromVideos.length) return fromVideos.slice(0, 8)

  const fromThemes = themes.slice(0, 8).map((theme, index) => ({
    title: clean(theme.slug || `Theme ${index + 1}`, 160),
    type: String(theme.type || '').toUpperCase() === 'ED' ? 'Ending' : 'Opening',
    ...(theme.sequence ? { sequence: theme.sequence } : {}),
    url: searchUrl
  }))
  return fromThemes.length ? fromThemes : fallback
}
export async function randomWaifu() { const data = await requestJson(IMAGE_API, {}, 'safe anime image', 5000); const item = data.results?.[0]; const imageUrl = httpsUrl(item?.url); if (!imageUrl) throw new UserFacingError('A safe character image was not available.'); return { imageUrl, name: 'Random anime character', source: httpsUrl(item?.source_url) || imageUrl } }
const animeQuotes = ['The future belongs to those who believe in the beauty of their dreams. — anime-inspired quote', 'A lesson without pain is meaningless. — anime-inspired quote', 'Even the smallest step forward is still progress. — anime-inspired quote', 'The bonds we make give us strength. — anime-inspired quote']
export function randomAnimeQuote() { return animeQuotes[Math.floor(Math.random() * animeQuotes.length)] }
export async function compareCharacters(left, right) { const [a, b] = await Promise.all([searchCharacter(left), searchCharacter(right)]); const first = a.results[0]; const second = b.results[0]; if (!first || !second) throw new UserFacingError('Both characters must be found in the anime database.'); const aScore = first.favorites || 0; const bScore = second.favorites || 0; const winner = aScore === bScore ? 'Too close to call' : aScore > bScore ? first.name : second.name; return { first, second, winner, basis: 'database popularity/favorites, not a canon power-scaling verdict' } }
const moodMap = { action: 'action', fantasy: 'fantasy', romance: 'romance', comedy: 'comedy', relaxing: 'slice of life', calm: 'slice of life', energetic: 'action', something: 'recommendation' }
export async function recommendAnime(query) { const q = clean(query, 120); if (!q) throw new UserFacingError('Usage: .recommend genre, mood, or anime title'); const token = q.toLowerCase().split(/\s+/).find(word => moodMap[word]); const search = moodMap[token] && moodMap[token] !== 'recommendation' ? moodMap[token] : q; const data = await searchAnime(search); return data.results.slice(0, 5) }
const quizBank = [
  { question: 'Which anime follows a young ninja named Naruto Uzumaki?', options: ['Naruto', 'Bleach', 'One Piece', 'Death Note'], answer: 1 },
  { question: 'What is the name of the notebook in Death Note?', options: ['Soul Book', 'Death Note', 'Black Ledger', 'Shinigami File'], answer: 2 },
  { question: 'Which series features the Straw Hat Pirates?', options: ['One Piece', 'Fairy Tail', 'Hunter x Hunter', 'Blue Exorcist'], answer: 1 },
  { question: 'In Demon Slayer, what is Tanjiro Kamado’s sister called?', options: ['Sakura', 'Nezuko', 'Mikasa', 'Nobara'], answer: 2 },
  { question: 'Which anime is set in a world where humans fight Titans?', options: ['Black Clover', 'Attack on Titan', 'Jujutsu Kaisen', 'Vinland Saga'], answer: 2 }
]
export function createQuizService({ clock = now } = {}) { const sessions = new Map(); const keyOf = (chat, sender) => `${chat}:${sender}`; return { start(chat, sender) { const key = keyOf(chat, sender); const offset = sessions.size % quizBank.length; const questions = [...quizBank.slice(offset), ...quizBank.slice(0, offset)].slice(0, 3); const session = { questions, index: 0, score: 0, expiresAt: clock() + 300_000 }; sessions.set(key, session); return session.questions[0] }, answer(chat, sender, value) { const key = keyOf(chat, sender); const session = sessions.get(key); if (!session || session.expiresAt <= clock()) { sessions.delete(key); throw new UserFacingError('No active quiz. Start one with .animequiz.'); } const choice = Number(value); if (!Number.isInteger(choice) || choice < 1 || choice > 4) throw new UserFacingError('Answer with a number from 1 to 4.'); const current = session.questions[session.index]; const correct = choice === current.answer; if (correct) session.score += 1; session.index += 1; if (session.index >= session.questions.length) { const result = { done: true, score: session.score, total: session.questions.length, correct, answer: current.options[current.answer - 1] }; sessions.delete(key); return result } return { done: false, score: session.score, correct, answer: current.options[current.answer - 1], question: session.questions[session.index] } } } }
export function parseBattleArgs(raw) { const match = String(raw || '').trim().match(/^(.+?)\s+vs\.?\s+(.+)$/i); if (!match) throw new UserFacingError('Usage: .anibattle character 1 vs character 2'); return [match[1].trim(), match[2].trim()] }
export function clearAnimeCache() { cache.clear() }
