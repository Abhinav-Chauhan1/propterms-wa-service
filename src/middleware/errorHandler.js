import logger from '../lib/logger.js'

export function errorHandler(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? 500
  logger.error({ status, path: req.path, err: err.message }, 'Request error')
  res.status(status).json({ error: err.message ?? 'Internal Server Error' })
}
