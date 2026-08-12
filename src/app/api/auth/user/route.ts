import { NextRequest } from 'next/server';
import { GET as getMe } from '@/app/api/auth/me/route';

export async function GET(request: NextRequest) {
  return getMe(request);
}
