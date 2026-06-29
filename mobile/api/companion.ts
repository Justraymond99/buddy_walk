import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  dispatchCompanionRoute,
  setCompanionCors,
} from './_lib/companionRoutes';

function readRoute(req: VercelRequest): string {
  const raw = req.query.route;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw[0]) return String(raw[0]);
  return '';
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  setCompanionCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const route = readRoute(req);
  if (!route) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  dispatchCompanionRoute(req, res, [route]);
}
