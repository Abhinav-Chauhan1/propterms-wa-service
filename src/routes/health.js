import { Router } from 'express'
import { getStatus } from '../wa/client.js'
import { getQueueLength } from '../wa/queue.js'

const router = Router()

router.get('/', (req, res) => {
  const { status } = getStatus()
  res.json({
    service: 'propterms-wa-service',
    uptime: Math.floor(process.uptime()),
    wa: status,
    queue: getQueueLength(),
    timestamp: new Date().toISOString(),
  })
})

export default router
