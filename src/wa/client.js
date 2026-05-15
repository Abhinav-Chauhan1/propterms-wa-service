import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { getAuthState } from './sessionStore.js'
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

      if (loggedOut) {
        connectionStatus = 'logged_out'
        logger.error({ statusCode }, 'Logged out — manual re-auth required, session NOT cleared')
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
