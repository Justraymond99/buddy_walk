import fs from 'fs';
import path from 'path';
import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const candidates = [
    path.join(process.cwd(), 'server', 'views', 'companion.html'),
    path.join(__dirname, '..', 'server', 'views', 'companion.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedTemplate = fs.readFileSync(candidate, 'utf8');
      return cachedTemplate;
    }
  }
  throw new Error('companion.html viewer template not found');
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const raw = req.query.token;
  const token = (Array.isArray(raw) ? raw[0] : raw || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!token) {
    res.status(400).send('Missing session token.');
    return;
  }

  try {
    const html = loadTemplate().replace(
      'window.__COMPANION_TOKEN__ || ""',
      JSON.stringify(token)
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error) {
    console.error('[companion-viewer]', error);
    res.status(500).send('Companion viewer is not available right now.');
  }
}
