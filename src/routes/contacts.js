import { Router } from 'express'
import { parse } from 'csv-parse/sync'
import multer from 'multer'
import prisma from '../lib/prisma.js'
import { formatPhone, isValidPhone } from '../lib/phone.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

router.get('/', async (req, res, next) => {
  try {
    const where = req.query.group ? { group: req.query.group } : {}
    const contacts = await prisma.waContact.findMany({ where, orderBy: { createdAt: 'desc' } })
    res.json(contacts)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { phone, name, group, tags, source } = req.body
    if (!phone || !name || !group) {
      return res.status(400).json({ error: 'phone, name, and group are required' })
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' })
    }
    const contact = await prisma.waContact.create({
      data: { phone: formatPhone(phone), name, group, tags: tags ?? [], source: source ?? 'MANUAL' },
    })
    res.status(201).json(contact)
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Phone number already exists' })
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const { name, group, tags } = req.body
    const contact = await prisma.waContact.update({
      where: { id: req.params.id },
      data: { name, group, tags },
    })
    res.json(contact)
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Contact not found' })
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.waContact.delete({ where: { id: req.params.id } })
    res.json({ message: 'Deleted' })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Contact not found' })
    next(err)
  }
})

router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const { group } = req.body
    if (!group) return res.status(400).json({ error: 'group is required' })

    const records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })

    let created = 0
    let skipped = 0
    const errors = []

    for (const row of records) {
      const phone = row.phone ?? row.Phone ?? row.mobile ?? row.Mobile ?? ''
      const name = row.name ?? row.Name ?? ''

      if (!phone || !name) {
        errors.push({ row, reason: 'Missing phone or name' })
        continue
      }
      if (!isValidPhone(phone)) {
        errors.push({ row, reason: 'Invalid phone number' })
        continue
      }

      try {
        await prisma.waContact.upsert({
          where: { phone: formatPhone(phone) },
          update: { name, group },
          create: { phone: formatPhone(phone), name, group, source: 'CSV' },
        })
        created++
      } catch {
        skipped++
      }
    }

    res.json({ created, skipped, errors })
  } catch (err) {
    next(err)
  }
})

// Sync owners, tenants, and leads from the main PropTerms DB
router.post('/sync', async (req, res, next) => {
  try {
    const [owners, tenants, leads] = await Promise.all([
      prisma.owner.findMany({ where: { phone: { not: null } }, select: { name: true, phone: true } }),
      prisma.tenant.findMany({ where: { phone: { not: null } }, select: { name: true, phone: true } }),
      prisma.lead.findMany({ where: { phone: { not: '' } }, select: { name: true, phone: true } }),
    ])

    let synced = 0

    const upsert = async (name, phone, group) => {
      if (!isValidPhone(phone)) return
      await prisma.waContact.upsert({
        where: { phone: formatPhone(phone) },
        update: { name, group },
        create: { phone: formatPhone(phone), name, group, source: 'DB_SYNC' },
      })
      synced++
    }

    for (const o of owners) await upsert(o.name, o.phone, 'OWNER')
    for (const t of tenants) await upsert(t.name, t.phone, 'TENANT')
    for (const l of leads) await upsert(l.name, l.phone, 'LEAD')

    res.json({ synced })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/optout', async (req, res, next) => {
  try {
    const contact = await prisma.waContact.update({
      where: { id: req.params.id },
      data: { optedOut: true, optedOutAt: new Date() },
    })
    res.json(contact)
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Contact not found' })
    next(err)
  }
})

export default router
