import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { enqueue } from '../wa/queue.js'
import { resolveTemplate } from '../lib/templateUtils.js'
import { getCampaignContacts } from '../lib/campaignUtils.js'

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const campaigns = await prisma.waCampaign.findMany({
      include: { template: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(campaigns)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { name, templateId, contactGroup, contactIds, scheduledAt } = req.body
    if (!name || !templateId) {
      return res.status(400).json({ error: 'name and templateId are required' })
    }
    const campaign = await prisma.waCampaign.create({
      data: {
        name,
        templateId,
        contactGroup,
        contactIds: contactIds ?? [],
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
      },
    })
    res.status(201).json(campaign)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/schedule', async (req, res, next) => {
  try {
    const { scheduledAt } = req.body
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt is required' })
    const campaign = await prisma.waCampaign.update({
      where: { id: req.params.id },
      data: { scheduledAt: new Date(scheduledAt), status: 'SCHEDULED' },
    })
    res.json(campaign)
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' })
    next(err)
  }
})

router.post('/:id/send', async (req, res, next) => {
  try {
    const campaign = await prisma.waCampaign.findUnique({
      where: { id: req.params.id },
      include: { template: true },
    })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
    if (campaign.status === 'RUNNING') {
      return res.status(409).json({ error: 'Campaign already running' })
    }

    const contacts = await getCampaignContacts(campaign)

    await prisma.waCampaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING', startedAt: new Date(), total: contacts.length },
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

    res.json({ message: 'Campaign started', total: contacts.length })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/pause', async (req, res, next) => {
  try {
    const campaign = await prisma.waCampaign.update({
      where: { id: req.params.id },
      data: { status: 'PAUSED' },
    })
    res.json(campaign)
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' })
    next(err)
  }
})

router.post('/:id/resume', async (req, res, next) => {
  try {
    const campaign = await prisma.waCampaign.findUnique({
      where: { id: req.params.id },
      include: {
        template: true,
        messages: { where: { status: 'QUEUED' } },
      },
    })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })

    await prisma.waCampaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING' },
    })

    for (const msg of campaign.messages) {
      const contact = await prisma.waContact.findUnique({ where: { id: msg.contactId } })
      if (!contact) continue
      enqueue({
        id: msg.id,
        contactId: contact.id,
        phone: contact.phone,
        body: msg.body,
        mediaUrl: msg.mediaUrl,
        mediaType: campaign.template.mediaType,
        campaignId: campaign.id,
      })
    }

    res.json({ message: 'Campaign resumed', queued: campaign.messages.length })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' })
    next(err)
  }
})

router.get('/:id/stats', async (req, res, next) => {
  try {
    const campaign = await prisma.waCampaign.findUnique({
      where: { id: req.params.id },
      select: { name: true, status: true, total: true, sent: true, failed: true, replied: true },
    })
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
    res.json(campaign)
  } catch (err) {
    next(err)
  }
})

export default router
