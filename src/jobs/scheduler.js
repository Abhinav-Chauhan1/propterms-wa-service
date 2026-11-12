import prisma from '../lib/prisma.js'
import { enqueue } from '../wa/queue.js'
import { resolveTemplate } from '../lib/templateUtils.js'
import { getCampaignContacts } from '../lib/campaignUtils.js'
import { withDbRetry } from '../lib/dbRetry.js'
import logger from '../lib/logger.js'

// The scheduler used to poll the database every minute (cron '* * * * *'), 24/7.
// That kept the Neon compute awake permanently and used up the free plan's compute
// hours. It now sleeps until the next scheduled campaign is due and only touches the
// database when there is work, so Neon can scale to zero in between.
//
// - startScheduler() arms the timer once at boot.
// - rearmScheduler() must be called whenever a campaign becomes SCHEDULED or its
//   scheduledAt changes (see routes/campaigns.js).
// - MAX_WAIT_MS is a safety net that re-checks the database now and then (and keeps
//   the delay within setTimeout's 32-bit limit); it is ~4 short wake-ups a day.
// - RETRY_MS is the back-off after a failed tick so a failure cannot cause a tight loop.
const MAX_WAIT_MS = Number(process.env.SCHEDULER_MAX_WAIT_MS) || 6 * 60 * 60 * 1000
const RETRY_MS = Number(process.env.SCHEDULER_RETRY_MS) || 60 * 1000

let timer = null
let ticking = false
let lastTickFailed = false

async function nextScheduledAt() {
  const next = await withDbRetry(() =>
    prisma.waCampaign.findFirst({
      where: { status: 'SCHEDULED', scheduledAt: { not: null } },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    })
  )
  return next?.scheduledAt ?? null
}

async function triggerCampaign(campaign, now) {
  logger.info({ campaignId: campaign.id, name: campaign.name }, 'Triggering scheduled campaign')

  const contacts = await getCampaignContacts(campaign)

  await prisma.waCampaign.update({
    where: { id: campaign.id },
    data: { status: 'RUNNING', startedAt: now, total: contacts.length },
  })

  for (const contact of contacts) {
    const body = resolveTemplate(campaign.template.body, contact)
    const message = await prisma.waMessage.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        direction: 'OUTBOUND',
        body,
        mediaUrl: campaign.template.mediaUrl,
        status: 'QUEUED',
      },
    })
    enqueue({
      id: message.id,
      contactId: contact.id,
      phone: contact.phone,
      body,
      mediaUrl: campaign.template.mediaUrl,
      mediaType: campaign.template.mediaType,
      campaignId: campaign.id,
    })
  }
}

async function processDueCampaigns() {
  const now = new Date()
  const due = await withDbRetry(() =>
    prisma.waCampaign.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      include: { template: true },
    })
  )

  for (const campaign of due) {
    await triggerCampaign(campaign, now)
  }
}

async function tick() {
  timer = null
  if (ticking) return
  ticking = true
  try {
    await processDueCampaigns()
    lastTickFailed = false
  } catch (err) {
    lastTickFailed = true
    logger.error(err, 'Scheduler tick error')
  } finally {
    ticking = false
    await rearmScheduler()
  }
}

export async function rearmScheduler() {
  clearTimeout(timer)
  timer = null

  let delay
  try {
    const at = await nextScheduledAt()
    delay = at ? Math.max(at.getTime() - Date.now(), 0) : MAX_WAIT_MS
    // A failed tick leaves its campaign SCHEDULED and already due; back off instead of spinning.
    if (lastTickFailed) delay = Math.max(delay, RETRY_MS)
  } catch (err) {
    logger.error(err, 'Scheduler could not read the next campaign; retrying later')
    delay = RETRY_MS
  }

  delay = Math.min(delay, MAX_WAIT_MS)
  clearTimeout(timer) // a concurrent rearm may have set one while we awaited the query
  timer = setTimeout(tick, delay)
  logger.info({ inMs: delay }, 'Campaign scheduler armed')
}

export function startScheduler() {
  return rearmScheduler()
}
