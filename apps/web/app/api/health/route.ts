import { NextResponse } from 'next/server';
import { checkDbConnection } from '../../../lib/db';

export async function GET() {
  try {
    await checkDbConnection();
    return NextResponse.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', db: 'unreachable', message: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
