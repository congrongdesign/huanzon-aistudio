import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { DESKTOP_GUEST_USER_ID, isDesktopGuestMode } from '@/lib/guest';
import { isLocalBackendEnabled } from '@/lib/local-backend';

const JWT_SECRET = process.env.JWT_SECRET || 'hz-ai-studio-secret-key-2026';
const JWT_EXPIRES_IN = '30d';

export interface JWTPayload {
  userId: string;
  email: string;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * 从请求中获取当前用户 ID
 * 可从 Cookie 或 Authorization header 获取 token
 */
export function getCurrentUserId(request: NextRequest): string | null {
  if (isDesktopGuestMode() || isLocalBackendEnabled()) {
    return DESKTOP_GUEST_USER_ID;
  }

  // 优先从 Cookie 获取
  const cookieToken = request.cookies.get('auth_token')?.value;
  if (cookieToken) {
    const payload = verifyToken(cookieToken);
    if (payload) {
      return payload.userId;
    }
  }

  // 从 Authorization header 获取
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const headerToken = authHeader.slice(7);
    const payload = verifyToken(headerToken);
    if (payload) {
      return payload.userId;
    }
  }

  return null;
}
