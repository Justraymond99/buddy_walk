import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Request, Response } from 'express';

export function setApiCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export async function runExpressHandler(
  req: VercelRequest,
  res: VercelResponse,
  handler: (req: Request, res: Response) => void | Promise<void>
): Promise<void> {
  const mockReq = {
    body: req.body,
    query: req.query,
    params: req.query,
    headers: req.headers,
    method: req.method,
  } as unknown as Request;

  let statusCode = 200;
  const headers: Record<string, string | number | string[]> = {};
  let ended = false;

  const flushHeaders = () => {
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  };

  const mockRes = {
    status(code: number) {
      statusCode = code;
      return mockRes;
    },
    setHeader(key: string, value: string | number | string[]) {
      headers[key] = value;
      return mockRes;
    },
    set(key: string, value: string | number | string[]) {
      return mockRes.setHeader(key, value);
    },
    contentType(type: string) {
      headers['Content-Type'] = type;
      return mockRes;
    },
    json(data: unknown) {
      if (ended) return mockRes;
      ended = true;
      flushHeaders();
      res.status(statusCode).json(data);
      return mockRes;
    },
    send(data: unknown) {
      if (ended) return mockRes;
      ended = true;
      flushHeaders();
      res.status(statusCode).send(data as never);
      return mockRes;
    },
  } as unknown as Response;

  await handler(mockReq, mockRes);
  if (!ended) {
    flushHeaders();
    res.status(statusCode).end();
  }
}

export function createHandler(
  handler: (req: Request, res: Response) => void | Promise<void>,
  methods: string[]
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    setApiCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (!req.method || !methods.includes(req.method)) {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    await runExpressHandler(req, res, handler);
  };
}
