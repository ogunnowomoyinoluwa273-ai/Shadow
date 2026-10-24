import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveFfmpeg, resolveFfprobe } from './media.js'
import { UserFacingError } from '../utils/errors.js'

const exec = promisify(execFile)
const URL_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com', 'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com', 'fb.watch', 'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'])
const EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.mp4', '.mkv', '.webm', '.mov', '.avi', '.jpg', '.jpeg', '.png', '.webp'])

export function validateMediaUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new UserFacingError('Provide a valid public HTTPS media URL.') }
  if (url.protocol !== 'https:') throw new UserFacingError('Only HTTPS media URLs are supported.')
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!URL_HOSTS.has(host) && ![...URL_HOSTS].some(item => host.endsWith(`.${item}`))) throw new UserFacingError('That platform is not supported.')
  return url.toString()
}
export function validateAnimeThemeUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new UserFacingError('Provide a valid HTTPS AnimeThemes video URL.') }
  if (url.protocol !== 'https:') throw new UserFacingError('Only HTTPS AnimeThemes video URLs are supported.')
  if (url.hostname.toLowerCase() !== 'v.animethemes.moe' || url.username || url.password || url.port) throw new UserFacingError('Only direct videos hosted by v.animethemes.moe are supported.')
  if (!/\.(?:webm|mp4|m4v|mkv)$/i.test(url.pathname)) throw new UserFacingError('The AnimeThemes URL must point to a supported video file.')
  return url.toString()
}

function safeJsonLines(stdout) {
  return String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
}
function duration(value) { const seconds = Number(value); if (!Number.isFinite(seconds)) return ''; const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function cleanTitle(value) { return String(value || 'Untitled').replace(/[\r\n]+/g, ' ').slice(0, 180) }
function isAudio(ext) { return ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav'].includes(ext) }
function isImage(ext) { return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) }
function isVideo(ext) { return ['.mp4', '.mkv', '.webm', '.mov', '.avi'].includes(ext) }
export function videoMimeType(ext) { return ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo' })[ext] || 'video/mp4' }
export function formatMaxFileSize(bytes) { const value = Number(bytes); if (!Number.isFinite(value) || value <= 0) throw new Error('Download size limit must be positive.'); if (value >= 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024 * 1024))}G`; return `${Math.max(1, Math.round(value / (1024 * 1024)))}M` }
const transferArgs = ['--concurrent-fragments', '4', '--retries', '3', '--fragment-retries', '3', '--socket-timeout', '30']
const MiB = 1024 * 1024
function validateQuality(quality) { if (!['sd', 'hd'].includes(quality)) throw new Error('Quality must be SD or HD.'); return quality }
function miBText(bytes) { const amount = Number(bytes) / MiB; return Number.isInteger(amount) ? String(amount) : amount.toFixed(1) }
export function formatSizeLimitMessage(actualBytes, maxBytes, quality = 'sd', mode = 'video') {
  const limit = `${miBText(maxBytes)} MiB`
  const actual = actualBytes != null && Number.isFinite(Number(actualBytes)) ? `Downloaded media (${miBText(actualBytes)} MiB) exceeds` : 'The media may exceed'
  const nextStep = mode === 'audio'
    ? quality === 'hd' ? 'Retry without `hd` for standard 128 kbps audio.' : 'Try a shorter audio item.'
    : quality === 'hd' ? 'Retry without `hd` to request SD.' : 'SD was already selected; try a shorter clip.'
  return `${actual} Shadow’s ${limit} download limit. ${nextStep} DOWNLOADER_MAX_BYTES can be raised intentionally, but its configured maximum is 100 MiB.`
}
function codedError(message, code) { return new UserFacingError(message, { code }) }
function normalizeDownloadError(error, quality, maxBytes, mode) {
  if (error?.code === 'SHADOW_SIZE_LIMIT' || error?.code === 'SHADOW_QUALITY_UNAVAILABLE') return error
  const detail = String(error?.providerDetail || error?.message || '')
  if (/max-file.?size|file is larger than|file size.{0,30}(?:exceed|limit)|file.{0,20}too large/i.test(detail)) return codedError(formatSizeLimitMessage(undefined, maxBytes, quality, mode), 'SHADOW_SIZE_LIMIT')
  if (mode === 'video' && /requested format is not available|no suitable formats? found|no video formats? found/i.test(detail)) {
    const requested = quality === 'hd' ? 'HD (720p–1080p)' : 'SD (up to 480p)'
    const alternative = quality === 'hd' ? 'Remove `hd` to request SD.' : 'Add `hd` only if you want a higher-data version.'
    return codedError(`No ${requested} video is available for this link. Shadow did not switch quality automatically. ${alternative}`, 'SHADOW_QUALITY_UNAVAILABLE')
  }
  return error
}
const videoFormat = quality => quality === 'hd'
  ? 'bv*[height>=720][height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height>=720][height<=1080][ext=mp4][vcodec^=avc1]/bv*[height>=720][height<=1080]+ba/b[height>=720][height<=1080]/bv*[height>=720][height<=1080]'
  : 'bv*[height<=480][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=480][ext=mp4][vcodec^=avc1]/bv*[height<=480]+ba/b[height<=480]/bv*[height<=480]'
export function buildAudioArgs(maxBytes, quality = 'sd') { validateQuality(quality); return ['--no-playlist', '--no-warnings', '--no-progress', '--restrict-filenames', ...transferArgs, '--max-filesize', formatMaxFileSize(maxBytes), '-P', 'OUTPUT_DIR', '-o', '%(id)s.%(ext)s', '-f', 'ba[ext=m4a]/ba/bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', quality === 'hd' ? '320K' : '128K'] }
export function buildVideoArgs(maxBytes, quality = 'sd') { validateQuality(quality); return ['--no-playlist', '--no-warnings', '--no-progress', '--restrict-filenames', ...transferArgs, '--max-filesize', formatMaxFileSize(maxBytes), '-P', 'OUTPUT_DIR', '-o', '%(id)s.%(ext)s', '-f', videoFormat(quality), '--merge-output-format', 'mp4'] }

export function createDownloader({ config, maxBytes = config.downloaderMaxBytes, sessionTtlMs = 5 * 60 * 1000, execRunner = exec } = {}) {
  let executablePromise
  let active = 0
  const queue = []
  const sessions = new Map()
  const maxConcurrent = Math.max(1, Number(config.downloaderConcurrency) || 1)
  const runLimited = task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump() })
  const pump = () => { while (active < maxConcurrent && queue.length) { const item = queue.shift(); active += 1; Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { active -= 1; pump() }) } }
  const resolveExecutable = async () => {
    if (!executablePromise) executablePromise = (async () => {
      const candidates = [config.ytdlpPath, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp', 'yt-dlp'] .filter(Boolean)
      if (process.platform === 'win32') for (const locator of [['where.exe', ['yt-dlp.exe']], ['cmd.exe', ['/d', '/s', '/c', 'where yt-dlp.exe']]]) { try { const result = await exec(locator[0], locator[1], { windowsHide: true }); const found = String(result.stdout).split(/\r?\n/).map(line => line.trim()).find(line => /yt-dlp(?:\.exe)?$/i.test(line)); if (found) candidates.unshift(found) } catch {} }
      for (const candidate of [...new Set(candidates)]) try { await execRunner(candidate, ['--version'], { windowsHide: true }); return candidate } catch {}
      throw new Error('yt-dlp was not found. Install the official yt-dlp executable or set YTDLP_PATH in .env, then restart Shadow.')
    })()
    try { return await executablePromise } catch (error) { executablePromise = undefined; throw error }
  }
  const run = async (args, { cwd, timeout = config.downloaderTimeoutMs } = {}) => {
    const executable = await resolveExecutable()
    try { return await execRunner(executable, args, { cwd, timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true }) } catch (error) {
      const providerDetail = String(error.stderr || error.message || 'download provider error')
      const detail = providerDetail.split(/\r?\n/).filter(Boolean).slice(-1)[0]
      const failure = new Error(`Downloader failed: ${detail.slice(0, 240)}`)
      failure.providerDetail = providerDetail
      throw failure
    }
  }
  const inspectSearch = async query => {
    const result = await run(['--simulate', '--dump-single-json', '--flat-playlist', '--no-warnings', `ytsearch5:${query}`])
    const root = safeJsonLines(result.stdout).find(item => item.entries) || {}
    return (root.entries || []).slice(0, 5).filter(item => item.id || item.url).map((item, index) => ({ index: index + 1, id: item.id, url: item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : ''), title: cleanTitle(item.title), uploader: cleanTitle(item.uploader || item.channel || 'Unknown'), duration: duration(item.duration) }))
  }
  const cleanup = async dir => { try { await fs.rm(dir, { recursive: true, force: true }) } catch {} }
  const probe = async file => {
    let result
    try { result = await exec(await resolveFfprobe(), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file], { windowsHide: true, maxBuffer: 256 * 1024 }) } catch { throw new Error('Downloaded media failed FFprobe validation.') }
    let data
    try { data = JSON.parse(result.stdout) } catch { throw new Error('Downloaded media returned invalid FFprobe output.') }
    const streams = Array.isArray(data.streams) ? data.streams : []
    if (!streams.length) throw new Error('Downloaded media contains no playable streams.')
    return streams
  }
  const transcode = async (input, mode, dir, quality = 'sd') => {
    const ffmpeg = await resolveFfmpeg()
    const output = path.join(dir, mode === 'audio' ? 'shadow-final.mp3' : 'shadow-final.mp4')
    const args = mode === 'audio'
      ? ['-y', '-i', input, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', quality === 'hd' ? '320k' : '128k', output]
      : ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]
    try { await exec(ffmpeg, args, { windowsHide: true, timeout: config.downloaderTimeoutMs, maxBuffer: 2 * 1024 * 1024 }) } catch { throw new Error(`Downloaded ${mode} could not be converted to a WhatsApp-compatible file.`) }
    return output
  }
  const normalizeOutput = async (file, mode, dir, quality = 'sd') => {
    const streams = await probe(file)
    const video = streams.find(stream => stream.codec_type === 'video')
    const audio = streams.find(stream => stream.codec_type === 'audio')
    if (mode === 'audio') {
      if (!audio) throw new Error('Downloaded audio contains no audio stream.')
      if (path.extname(file).toLowerCase() === '.mp3' && audio.codec_name === 'mp3') return file
      return transcode(file, 'audio', dir, quality)
    }
    if (!video) throw new Error('Downloaded video contains no video stream.')
    if (path.extname(file).toLowerCase() === '.mp4' && video.codec_name === 'h264' && (!audio || audio.codec_name === 'aac')) return file
    return transcode(file, 'video', dir)
  }
  const downloadWithValidator = ({ url, mode = 'video', quality = 'sd', title, validator = validateMediaUrl } = {}) => runLimited(async () => {
    const selectedQuality = validateQuality(quality)
    const valid = validator(url); const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-download-'))
    try {
      const args = (mode === 'audio' ? buildAudioArgs(maxBytes, selectedQuality) : buildVideoArgs(maxBytes, selectedQuality)).map(value => value === 'OUTPUT_DIR' ? dir : value)
      args.push(valid)
      const metadata = safeJsonLines((await run([...args, '--print', 'after_move:__SHADOW_PATH__%(filepath)s'])).stdout).find(item => item.id) || {}
      const files = (await fs.readdir(dir)).filter(name => !name.endsWith('.part') && !name.endsWith('.ytdl'))
      const candidates = files.filter(name => mode === 'audio' ? isAudio(path.extname(name).toLowerCase()) : isVideo(path.extname(name).toLowerCase()) || isImage(path.extname(name).toLowerCase()))
      if (candidates.length !== 1) throw new Error(candidates.length ? 'Download post-processing did not produce one complete media file.' : 'The provider returned no downloadable media.')
      let file = path.join(dir, candidates[0])
      file = await normalizeOutput(file, mode, dir, selectedQuality)
      const stat = await fs.stat(file)
      if (!stat.size) throw new Error('The provider returned an empty media file.')
      if (stat.size > maxBytes) throw codedError(formatSizeLimitMessage(stat.size, maxBytes, selectedQuality, mode), 'SHADOW_SIZE_LIMIT')
      await probe(file)
      return { file, dir, size: stat.size, title: cleanTitle(title || metadata.title || path.basename(file)), ext: path.extname(file).toLowerCase(), mode, quality: selectedQuality }
    } catch (error) { await cleanup(dir); throw normalizeDownloadError(error, selectedQuality, maxBytes, mode) }
  })
  const download = ({ url, mode = 'video', quality = 'sd' } = {}) => downloadWithValidator({ url, mode, quality, validator: validateMediaUrl })
  const downloadThemeAudio = theme => {
    if (!theme || !['Opening', 'Ending'].includes(theme.type)) throw new UserFacingError('No downloadable opening or ending audio was found for that anime.')
    return downloadWithValidator({ url: theme.url, mode: 'audio', title: theme.title, validator: validateAnimeThemeUrl })
  }
  const rememberSession = (chat, sender, results) => { const key = `${chat}:${sender}`; sessions.set(key, { results, expiresAt: Date.now() + sessionTtlMs }); return key }
  const getSession = (chat, sender) => { const key = `${chat}:${sender}`; const session = sessions.get(key); if (!session || session.expiresAt < Date.now()) { sessions.delete(key); return null } return session }
  const select = (chat, sender, number) => { const session = getSession(chat, sender); if (!session) throw new UserFacingError('That `.play` selection expired. Search again with `.play song name`.'); const result = session.results[number - 1]; if (!result) throw new UserFacingError('Choose one of the displayed result numbers.'); sessions.delete(`${chat}:${sender}`); return result }
  const payload = async result => { const buffer = await fs.readFile(result.file); const ext = result.ext; if (result.mode === 'audio' || isAudio(ext)) return { audio: buffer, mimetype: 'audio/mpeg', fileName: `${result.title.slice(0, 80)}.mp3` }; if (isImage(ext)) return { image: buffer, caption: result.title }; if (isVideo(ext)) return { video: buffer, mimetype: videoMimeType(ext), fileName: `${result.title.slice(0, 80)}${ext}`, caption: result.title }; return { document: buffer, mimetype: 'application/octet-stream', fileName: `${result.title.slice(0, 80)}${ext}`, caption: result.title } }
  const send = async (sock, jid, result, options = {}) => { try { const content = await payload(result); return await sock.sendMessage(jid, content, options) } finally { await cleanup(result.dir) } }
  return { resolveExecutable, validateMediaUrl, validateAnimeThemeUrl, async search(query, chat, sender) { const value = String(query || '').replace(/\s+/g, ' ').trim(); if (!value) throw new UserFacingError('Enter a song or video name to search.'); if (value.length > 120) throw new UserFacingError('Search terms must be 120 characters or fewer.'); const results = await runLimited(() => inspectSearch(value)); if (!results.length) throw new UserFacingError('No results were found.'); rememberSession(chat, sender, results); return results }, select, download, downloadThemeAudio, send, sessionCount: () => sessions.size }
}

export { URL_HOSTS, EXTENSIONS }
