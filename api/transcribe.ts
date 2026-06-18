import type { VercelRequest, VercelResponse } from '@vercel/node';
import { transcribeAudioBuffer } from '../server/services/transcribe';

export const config = {
  api: {
    bodyParser: false,
  },
};

function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const contentType = req.headers['content-type'];
  if (!contentType || typeof contentType !== 'string') {
    res.status(400).json({ error: 'Content-Type header is required' });
    return;
  }

  try {
    const audio = await readRawBody(req);
    const result = await transcribeAudioBuffer(audio, contentType);
    res.status(200).json(result);
  } catch (error) {
    console.error('api/transcribe error:', error);
    res.status(500).json({ error: 'Transcription failed' });
  }
}
