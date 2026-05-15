import cron from 'node-cron'
import prisma from '../lib/prisma.js'
import { enqueue } from '../wa/queue.js'
import { resolveTemplate } from '../lib/templateUtils.js'
import { getCampaignContacts } from '../lib/campaignUtils.js'
import logger from '../lib/logger.js'

export function startScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date()
      const due = await prisma.waCampaign.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
        include: { template: true },
      })

      for (const campaign of due) {
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
    } catch (err) {
      logger.error(err, 'Scheduler tick error')
    }
  })

  logger.info('Campaign scheduler started (runs every minute)')
}
