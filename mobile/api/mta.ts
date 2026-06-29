import type { Request, Response } from 'express';

import { getSubwayArrivals } from '../server/services/mta';
import { createHandler } from './_lib/vercelExpress';

async function mtaHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { routeId?: string; lat?: number; lon?: number };
  const routeId = body.routeId?.trim();
  const lat = Number(body.lat);
  const lon = Number(body.lon);

  if (!routeId) {
    res.status(400).json({ error: 'routeId is required' });
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'lat and lon are required' });
    return;
  }

  try {
    const arrivals = await getSubwayArrivals(routeId, lat, lon);
    res.status(200).json({ arrivals });
  } catch (e) {
    console.error('[MTA] arrivals error:', e);
    res.status(500).json({ error: 'Could not fetch MTA arrivals' });
  }
}

export default createHandler(mtaHandler, ['POST']);
