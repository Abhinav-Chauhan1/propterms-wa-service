import { getSocket } from './client.js'
import { formatPhone } from '../lib/phone.js'

export async function sendTextMessage(phone, body) {
  const sock = getSocket()
  if (!sock) throw new Error('WhatsApp not connected')

  const jid = `${formatPhone(phone)}@s.whatsapp.net`
  const result = await sock.sendMessage(jid, { text: body })
  return result.key.id
}

export async function sendMediaMessage(phone, body, mediaUrl, mediaType) {
  const sock = getSocket()
  if (!sock) throw new Error('WhatsApp not connected')

  const jid = `${formatPhone(phone)}@s.whatsapp.net`

  const content = {
    IMAGE: { image: { url: mediaUrl }, caption: body },
    VIDEO: { video: { url: mediaUrl }, caption: body },
    DOCUMENT: { document: { url: mediaUrl }, caption: body },
  }[mediaType] ?? { text: body }

  const result = await sock.sendMessage(jid, content)
  return result.key.id
}
