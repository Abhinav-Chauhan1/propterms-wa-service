import { QUEUE_DELAY_MIN, QUEUE_DELAY_MAX } from '../constants.js'
import { sendTextMessage, sendMediaMessage } from './sender.js'
import prisma from '../lib/prisma.js'
import logger from '../lib/logger.js'

const queue = []
let processing = false

function randomDelay() {
  return Math.floor(Math.random() * (QUEUE_DELAY_MAX - QUEUE_DELAY_MIN + 1)) + QUEUE_DELAY_MIN
}

export function enqueue(item) {
  queue.push(item)
  if (!processing) processNext()
}

export function clearQueue() {
  queue.length = 0
}

export function getQueueLength() {
  return queue.length
}

async function processNext() {
  if (queue.length === 0) {
    processing = false
    return
  }

  processing = true
  const msg = queue.shift()

  try {
    await processMessage(msg)
  } catch (err) {
    logger.error({ contactId: msg.contactId, messageId: msg.id }, 'Queue send failure')
    if (msg.id) {
      await prisma.waMessage
        .update({ where: { id: msg.id }, data: { status: 'FAILED', errorReason: err.message } })
        .catch(() => {})
    }
    if (msg.campaignId) {
      await incrementCampaignCounter(msg.campaignId, 'failed')
    }
  }

  setTimeout(processNext, randomDelay())
}

async function processMessage(msg) {
  const { id, contactId, phone, body, mediaUrl, mediaType, campaignId } = msg

  // If part of a campaign, check it hasn't been paused
  if (campaignId) {
    const campaign = await prisma.waCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    })
    if (campaign?.status === 'PAUSED') {
      logger.info({ campaignId, messageId: id }, 'Campaign paused — message left as QUEUED')
      return // stays QUEUED in DB; resume endpoint re-enqueues
    }
  }

  // _optoutReply bypasses the opted-out check — used for STOP/START acknowledgements
  if (!msg._optoutReply) {
    const contact = await prisma.waContact.findUnique({ where: { id: contactId } })
    if (!contact || contact.optedOut) {
      logger.warn({ contactId }, 'Skipping opted-out contact')
      if (id) {
        await prisma.waMessage.update({
          where: { id },
          data: { status: 'FAILED', errorReason: 'Contact opted out' },
        })
      }
      if (campaignId) await incrementCampaignCounter(campaignId, 'failed')
      return
    }
  }

  const waMessageId =
    mediaUrl && mediaType
      ? await sendMediaMessage(phone, body, mediaUrl, mediaType)
      : await sendTextMessage(phone, body)

  if (id) {
    await prisma.waMessage.update({
      where: { id },
      data: { status: 'SENT', waMessageId, sentAt: new Date() },
    })
  }

  if (campaignId) {
    await incrementCampaignCounter(campaignId, 'sent')
  }

  logger.info({ contactId, waMessageId }, 'Message sent')
}

async function incrementCampaignCounter(campaignId, field) {
  const updated = await prisma.waCampaign.update({
    where: { id: campaignId },
    data: { [field]: { increment: 1 } },
    select: { total: true, sent: true, failed: true },
  })

  if (updated.sent + updated.failed >= updated.total) {
    await prisma.waCampaign.update({
      where: { id: campaignId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
  }
}
