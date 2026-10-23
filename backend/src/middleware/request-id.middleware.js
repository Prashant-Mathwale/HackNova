import { randomUUID } from 'node:crypto';

export function requestIdMiddleware(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}
