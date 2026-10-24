import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unwrapMessage } from '../utils/message.js'
import { UserFacingError } from '../utils/errors.js'
const exec = promisify(execFile)
let ffmpegPathPromise
let ffprobePathPromise
export async function resolveFfmpeg() {
  if (!ffmpegPathPromise) {
    const candidates = [
      process.env.FFMPEG_PATH,
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
      process.platform === 'win32' && process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'ffmpeg', 'bin', 'ffmpeg.exe') : null,
      process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_', 'ffmpeg.exe') : null
    ].filter(Boolean)
    ffmpegPathPromise = (async () => {
      if (process.platform === 'win32') {
        for (const locator of [['where.exe', ['ffmpeg.exe']], ['cmd.exe', ['/d', '/s', '/c', 'where ffmpeg.exe']]]) {
          try {
            const located = (await exec(locator[0], locator[1], { windowsHide: true })).stdout.split(/\r?\n/).map(line => line.trim()).find(line => line && /ffmpeg(?:\.exe)?$/i.test(line))
            if (located) candidates.unshift(located)
          } catch {}
        }
      }
      for (const candidate of [...new Set(candidates)]) {
        try { await exec(candidate, ['-version'], { windowsHide: true }); return candidate } catch {}
      }
      throw new Error('FFmpeg was not found by the Shadow Node process. Restart Shadow after installing FFmpeg, or set FFMPEG_PATH in .env to the full path of ffmpeg.exe.')
    })()
  }
  try { return await ffmpegPathPromise } catch (error) { ffmpegPathPromise = undefined; throw error }
}
export async function resolveFfprobe() {
  if (!ffprobePathPromise) ffprobePathPromise = (async () => {
    const ffmpeg = await resolveFfmpeg().catch(() => '')
    const sibling = ffmpeg ? ffmpeg.replace(/ffmpeg(?:\.exe)?$/i, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : ''
    const candidates = [process.env.FFPROBE_PATH, sibling, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe', 'ffprobe'].filter(Boolean)
    if (process.platform === 'win32') for (const locator of [['where.exe', ['ffprobe.exe']], ['cmd.exe', ['/d', '/s', '/c', 'where ffprobe.exe']]]) {
      try { const located = (await exec(locator[0], locator[1], { windowsHide: true })).stdout.split(/\r?\n/).map(line => line.trim()).find(line => line && /ffprobe(?:\.exe)?$/i.test(line)); if (located) candidates.unshift(located) } catch {}
    }
    for (const candidate of [...new Set(candidates)]) try { await exec(candidate, ['-version'], { windowsHide: true }); return candidate } catch {}
    throw new Error('FFprobe was not found by the Shadow Node process. Install FFmpeg with FFprobe, or set FFPROBE_PATH in .env.')
  })()
  try { return await ffprobePathPromise } catch (error) { ffprobePathPromise = undefined; throw error }
}
export function mediaType(message) { const type = getContentType(unwrapMessage(message)); return ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(type) ? type : null }
export async function downloadQuotedMedia(quoted, sock) { const type = mediaType(quoted); if (!type) throw new UserFacingError('Reply to an image, video, audio, sticker, or document.'); const content = unwrapMessage(quoted); const buffer = await downloadMediaMessage(quoted, 'buffer', {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }); return { buffer, type, mimetype: content[type]?.mimetype || 'application/octet-stream', fileName: content[type]?.fileName || 'shadow-media' } }
async function convert(buffer, inputExt, outputExt, args) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-media-')); const input = path.join(dir, `input.${inputExt}`); const output = path.join(dir, `output.${outputExt}`); try { await fs.writeFile(input, buffer); const ffmpeg = await resolveFfmpeg(); await exec(ffmpeg, ['-y', '-i', input, ...args, output], { windowsHide: true }); return await fs.readFile(output) } catch (error) { if (error.message?.startsWith('FFmpeg was not found')) throw error; throw new UserFacingError('Media conversion failed. Check that the replied media is supported and try again.'); } finally { await fs.rm(dir, { recursive: true, force: true }) } }
export async function toSticker(media) { return convert(media.buffer, media.type === 'videoMessage' ? 'mp4' : 'png', 'webp', ['-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white', '-an', '-c:v', 'libwebp', '-loop', '0']) }
export async function toImage(media) { if (media.type === 'imageMessage') return media.buffer; return convert(media.buffer, media.type === 'stickerMessage' ? 'webp' : 'mp4', 'png', ['-frames:v', '1']) }
export async function toMp3(media) { return convert(media.buffer, media.type === 'audioMessage' ? 'ogg' : 'mp4', 'mp3', ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k']) }
