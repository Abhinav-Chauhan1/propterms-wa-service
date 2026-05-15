import { useMultiFileAuthState } from '@whiskeysockets/baileys'
import fs from 'fs/promises'
import path from 'path'
import { AUTH_INFO_DIR } from '../constants.js'

export async function getAuthState() {
  return useMultiFileAuthState(AUTH_INFO_DIR)
}

export async function clearAuthState() {
  try {
    const files = await fs.readdir(AUTH_INFO_DIR)
    await Promise.all(files.map((f) => fs.unlink(path.join(AUTH_INFO_DIR, f))))
  } catch {
    // directory empty or missing — nothing to clear
  }
}
