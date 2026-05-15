import { Router } from 'express'
import prisma from '../lib/prisma.js'

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const templates = await prisma.waTemplate.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(templates)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { name, category, body, variables, mediaUrl, mediaType } = req.body
    if (!name || !category || !body) {
      return res.status(400).json({ error: 'name, category, and body are required' })
    }
    const template = await prisma.waTemplate.create({
      data: { name, category, body, variables: variables ?? [], mediaUrl, mediaType },
    })
    res.status(201).json(template)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const { name, category, body, variables, mediaUrl, mediaType } = req.body
    const template = await prisma.waTemplate.update({
      where: { id: req.params.id },
      data: { name, category, body, variables, mediaUrl, mediaType },
    })
    res.json(template)
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Template not found' })
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.waTemplate.delete({ where: { id: req.params.id } })
    res.json({ message: 'Deleted' })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Template not found' })
    next(err)
  }
})

export default router
