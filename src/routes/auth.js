import { Router } from 'express'
import qrcode from 'qrcode'
import { getStatus, disconnectWhatsApp, reconnectWhatsApp } from '../wa/client.js'
import { clearAuthState } from '../wa/sessionStore.js'

const router = Router()

router.get('/status', async (req, res, next) => {
  try {
    const { status, qr } = getStatus()
    let qrDataUrl = null
    if (qr) qrDataUrl = await qrcode.toDataURL(qr)
    res.json({ status, qr: qrDataUrl })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', async (req, res, next) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Send { "confirm": true } to confirm logout' })
    }
    await disconnectWhatsApp()
    await clearAuthState()
    res.json({ message: 'Logged out and session cleared' })
  } catch (err) {
    next(err)
  }
})

router.post('/reconnect', async (req, res, next) => {
  try {
    await reconnectWhatsApp()
    res.json({ message: 'Reconnection initiated' })
  } catch (err) {
    next(err)
  }
})

export default router
