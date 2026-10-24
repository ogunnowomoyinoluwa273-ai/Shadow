import pino from 'pino'
import { config } from '../config.js'

export const logger = pino({ level: config.logLevel, base: undefined, redact: ['authState', 'creds', 'qr', 'pairingCode', 'pairing_code', 'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token', 'apiKey', 'api_key', 'api-key', 'password', 'secret', 'authorization', 'cookie'] })
