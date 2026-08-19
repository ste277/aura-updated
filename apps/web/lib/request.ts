import { NextRequest } from 'next/server';

type JsonObjectResult =
  | { ok: true; body: Record<string, unknown> | null }
  | { ok: false; error: 'malformed' };

export async function readJsonObject(req: NextRequest): Promise<JsonObjectResult> {
  try {
    const body = await req.json();
    return {
      ok: true,
      body: body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null,
    };
  } catch {
    return { ok: false, error: 'malformed' };
  }
}

export async function parseJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  const parsed = await readJsonObject(req);
  return parsed.ok ? parsed.body : null;
}
