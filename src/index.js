import 'dotenv/config'
import express from 'express'
import { API_KEY_MIN_LENGTH } from './constants.js'
import { apiKeyMiddleware } from './middleware/apiKey.js'
import { errorHandler } from './middleware/errorHandler.js'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import contactsRouter from './routes/contacts.js'
import templatesRouter from './routes/templates.js'
import campaignsRouter from './routes/campaigns.js'
import inboxRouter from './routes/inbox.js'
import { connectToWhatsApp, onConnected } from './wa/client.js'
import { startListener } from './wa/listener.js'
import { startScheduler } from './jobs/scheduler.js'
import logger from './lib/logger.js'

const { API_SECRET_KEY, ALLOWED_ORIGIN, PORT = '3001' } = process.env

if (!API_SECRET_KEY || API_SECRET_KEY.length < API_KEY_MIN_LENGTH) {
  logger.fatal(`API_SECRET_KEY must be at least ${API_KEY_MIN_LENGTH} characters — aborting`)
  process.exit(1)
}

const app = express()

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json())

app.use('/health', healthRouter)
app.use('/auth', apiKeyMiddleware, authRouter)
app.use('/contacts', apiKeyMiddleware, contactsRouter)
app.use('/templates', apiKeyMiddleware, templatesRouter)
app.use('/campaigns', apiKeyMiddleware, campaignsRouter)
app.use('/inbox', apiKeyMiddleware, inboxRouter)

app.use(errorHandler)

app.listen(Number(PORT), () => {
  logger.info(`propterms-wa-service listening on port ${PORT}`)
})

// Register listener before connecting so it's wired as soon as the socket opens
onConnected((sock) => startListener(sock))

connectToWhatsApp().catch((err) => {
  logger.error(err, 'Failed to start WhatsApp connection')
})

startScheduler()
