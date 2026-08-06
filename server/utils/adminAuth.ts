import { Request } from "express";

/** Optional ADMIN_TOKEN gate for read/export endpoints. Open when unset (local dev). */
export function isAdminAuthorized(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  const provided =
    (req.headers["x-admin-token"] as string | undefined) ||
    (req.query.token as string | undefined);
  return provided === expected;
}

export function parseLimit(req: Request, fallback: number, max: number): number {
  const raw = Number(req.query.limit);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, max) : fallback;
}

export function parseDateQuery(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function buildDateFilter(
  req: Request, 
  field = "serverTs"
): Record<string, Record<string, Date>> | undefined {
  const since = parseDateQuery(req.query.since);
  const until = parseDateQuery(req.query.until);
  if (!since && !until) return undefined;
  const range: Record<string, Date> = {};
  if (since) range.$gte = since;
  if (until) range.$lte = until;
  return { [field]: range };
}
