import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { getAuthState, clearAuthState } from './sessionStore.js'
import { RECONNECT_DELAY_MS } from '../constants.js'
import logger from '../lib/logger.js'

// Silent logger for Baileys internals — we handle our own logging
const baileysLogger = pino({ level: 'silent' })

let waSocket = null
let connectionStatus = 'disconnected'
let currentQR = null
let onConnectedCallback = null

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

  connectionStatus = 'connecting'
  currentQR = null

  const sock = makeWASocket({
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
        await clearAuthState()
        logger.warn({ statusCode }, 'Session invalid — auth cleared, click Reconnect to scan QR')
      } else {
        connectionStatus = 'disconnected'
        logger.warn({ statusCode }, `Connection closed — reconnecting in ${RECONNECT_DELAY_MS}ms`)
        setTimeout(connectToWhatsApp, RECONNECT_DELAY_MS)
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
