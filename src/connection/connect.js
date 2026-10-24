import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import { logger } from '../utils/logger.js'
import { config } from '../config.js'
import { errorLogDetails } from '../utils/errors.js'

export async function startConnection({ onSocket, onClosed }) {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir)
  const sock = makeWASocket({ auth: state, browser: Browsers.ubuntu(config.botName), logger, markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { logger.info('Scan the QR code below with WhatsApp > Linked devices'); qrcode.generate(qr, { small: true }) }
    if (connection === 'open') { logger.info({ jid: sock.user?.id }, 'WhatsApp connection open'); onSocket(sock); return }
    if (connection !== 'close') return
    const status = new Boom(lastDisconnect?.error)?.output?.statusCode
    const permanent = status === DisconnectReason.loggedOut || status === DisconnectReason.forbidden || status === DisconnectReason.badSession
    logger.warn({ status, permanent }, 'WhatsApp connection closed')
    await onClosed({ permanent, status })
  })
  if (!state.creds.registered && config.pairingNumber) {
    try {
      const code = await sock.requestPairingCode(config.pairingNumber)
      if (process.stdout.isTTY) process.stdout.write(`\nOne-time WhatsApp pairing code: ${code}\nEnter it on your phone and keep it private.\n`)
      else logger.info('Pairing code generated but not printed to non-interactive output; use QR login or run in a private terminal.')
    } catch (error) { logger.error({ err: errorLogDetails(error) }, 'Pairing code request failed') }
  }
  return sock
}
