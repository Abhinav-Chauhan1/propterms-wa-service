import { Router } from 'express'
import prisma from '../lib/prisma.js'

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const messages = await prisma.waMessage.findMany({
      where: { direction: 'INBOUND' },
      include: { contact: { select: { id: true, name: true, phone: true, group: true } } },
      orderBy: { receivedAt: 'desc' },
    })
    res.json(messages)
  } catch (err) {
    next(err)
  }
})

router.get('/:contactId', async (req, res, next) => {
  try {
    const messages = await prisma.waMessage.findMany({
      where: { contactId: req.params.contactId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (err) {
    next(err)
  }
})

// Mark read is a no-op for now — WaMessage has no read field in schema v1.
// Endpoint exists for API contract compatibility with the admin panel.
router.post('/:messageId/read', async (req, res, next) => {
  try {
    const message = await prisma.waMessage.findUnique({ where: { id: req.params.messageId } })
    if (!message) return res.status(404).json({ error: 'Message not found' })
    res.json(message)
  } catch (err) {
    next(err)
  }
})

export default router
