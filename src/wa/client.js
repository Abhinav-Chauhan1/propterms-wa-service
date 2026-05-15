import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { getAuthState, clearAuthState } from './sessionStore.js'
import { RECONNECT_DELAY_MS } from '../constants.js'
import logger from '../lib/logger.js'

const baileysLogger = pino({ level: 'silent' })
const MAX_RETRY_DELAY = 5 * 60 * 1000 // cap at 5 minutes

let waSocket = null
let connectionStatus = 'disconnected'
let currentQR = null
let onConnectedCallback = null
let retryDelay = RECONNECT_DELAY_MS

export function onConnected(fn) {
  onConnectedCallback = fn
}

export function getStatus() {
  return { status: connectionStatus, qr: currentQR }
}

export function getSocket() {
  return waSocket
}

export async function connectToWhatsApp() {
  const { state, saveCreds } = await getAuthState()
  const { version } = await fetchLatestBaileysVersion()

  connectionStatus = 'connecting'
  currentQR = null

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: baileysLogger,
    browser: ['PropTerms', 'Chrome', '1.0.0'],
  })

  waSocket = sock
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      currentQR = qr
      connectionStatus = 'qr_pending'
      logger.info('QR code ready — awaiting scan')
    }

    if (connection === 'open') {
      currentQR = null
      connectionStatus = 'connected'
      retryDelay = RECONNECT_DELAY_MS // reset backoff on success
      logger.info('WhatsApp connection established')
      if (onConnectedCallback) onConnectedCallback(sock)
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      // 405 = WhatsApp rejecting stale/unrecognised credentials (not in DisconnectReason enum)
      // badSession (500) and connectionReplaced (440) also indicate the saved session is unusable
      const badSession = statusCode === 405
        || statusCode === DisconnectReason.badSession
        || statusCode === DisconnectReason.connectionReplaced

      if (loggedOut || badSession) {
        connectionStatus = 'logged_out'
        currentQR = null
        retryDelay = RECONNECT_DELAY_MS
        await clearAuthState()
        logger.warn({ statusCode }, 'Session invalid — auth cleared, click Reconnect to scan QR')
      } else {
        connectionStatus = 'disconnected'
        logger.warn({ statusCode, retryDelay }, `Connection closed — reconnecting in ${retryDelay}ms`)
        setTimeout(connectToWhatsApp, retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY) // exponential backoff, max 5 min
      }
    }
  })
}

export async function disconnectWhatsApp() {
  if (waSocket) {
    try {
      await waSocket.logout()
    } catch {
      // socket may already be dead
    }
    waSocket = null
  }
  connectionStatus = 'logged_out'
}

export async function reconnectWhatsApp() {
  retryDelay = RECONNECT_DELAY_MS // reset backoff on manual reconnect
  if (waSocket) {
    try {
      waSocket.end()
    } catch {
      // ignore
    }
    waSocket = null
  }
  await connectToWhatsApp()
}
