import { INDIA_COUNTRY_CODE } from '../constants.js'

export function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '')

  if (digits.startsWith('91') && digits.length === 12) return digits
  if (digits.length === 10) return `${INDIA_COUNTRY_CODE}${digits}`
  if (digits.startsWith('0') && digits.length === 11) {
    return `${INDIA_COUNTRY_CODE}${digits.slice(1)}`
  }

  throw new Error(`Invalid phone number: ${raw}`)
}

export function isValidPhone(raw) {
  try {
    formatPhone(raw)
    return true
  } catch {
    return false
  }
}
