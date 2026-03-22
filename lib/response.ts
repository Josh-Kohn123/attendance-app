import type { VercelResponse } from "@vercel/node";

export function ok(res: VercelResponse, data?: any) {
  return res.status(200).json({ ok: true, data });
}

export function created(res: VercelResponse, data?: any) {
  return res.status(201).json({ ok: true, data });
}

export function error(res: VercelResponse, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, error: { code, message } });
}
