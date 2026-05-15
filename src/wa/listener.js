import prisma from '../lib/prisma.js'
import { enqueue } from './queue.js'
import { formatPhone } from '../lib/phone.js'
import { STOP_REPLY, START_REPLY } from '../constants.js'
import logger from '../lib/logger.js'

export function startListener(sock) {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue

      const rawJid = msg.key.remoteJid
      if (!rawJid || rawJid.includes('@g.us')) continue // ignore group messages

      const rawPhone = rawJid.replace('@s.whatsapp.net', '')
      let phone
      try {
        phone = formatPhone(rawPhone)
      } catch {
        continue
      }

      const body =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        ''

      const keyword = body.trim().toUpperCase()

      if (keyword === 'STOP') {
        await handleStop(phone, body)
        continue
      }

      if (keyword === 'START') {
        await handleStart(phone, body)
        continue
      }

      const contact = await prisma.waContact.findUnique({ where: { phone } })
      if (!contact) continue

      await prisma.waMessage.create({
        data: {
          contactId: contact.id,
          direction: 'INBOUND',
          body,
          status: 'RECEIVED',
          receivedAt: new Date(),
        },
      })

      logger.info({ contactId: contact.id }, 'Inbound message saved')
    }
  })
}

async function handleStop(phone, body) {
  const contact = await prisma.waContact.findUnique({ where: { phone } })
  if (!contact) return

  await prisma.waContact.update({
    where: { phone },
    data: { optedOut: true, optedOutAt: new Date() },
  })

  await prisma.waMessage.create({
    data: {
      contactId: contact.id,
      direction: 'INBOUND',
      body,
      status: 'RECEIVED',
      receivedAt: new Date(),
    },
  })

  // Send STOP_REPLY directly — opt-out check in queue would block this
  enqueue({ contactId: contact.id, phone, body: STOP_REPLY, _optoutReply: true })
  logger.info({ contactId: contact.id }, 'Contact opted out')
}

async function handleStart(phone, body) {
  const contact = await prisma.waContact.findUnique({ where: { phone } })
  if (!contact) return

  await prisma.waContact.update({
    where: { phone },
    data: { optedOut: false, optedOutAt: null },
  })

  await prisma.waMessage.create({
    data: {
      contactId: contact.id,
      direction: 'INBOUND',
      body,
      status: 'RECEIVED',
      receivedAt: new Date(),
    },
  })

  enqueue({ contactId: contact.id, phone, body: START_REPLY })
  logger.info({ contactId: contact.id }, 'Contact re-subscribed')
}
