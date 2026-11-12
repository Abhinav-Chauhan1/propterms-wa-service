// Neon suspends an idle compute and drops its connections. The first query after a
// wake-up can fail with a connection error, so retry those a couple of times.
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017'])
const RETRY_DELAYS_MS = [1000, 3000]

export async function withDbRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = RETRYABLE_CODES.has(err?.code) || /Closed|terminating connection/i.test(err?.message ?? '')
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}
