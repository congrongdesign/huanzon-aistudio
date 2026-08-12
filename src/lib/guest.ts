import type { User } from '@/lib/types';

export const DESKTOP_GUEST_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DESKTOP_GUEST_USER: User = {
  id: DESKTOP_GUEST_USER_ID,
  email: 'guest@huanzon.local',
  username: '访客模式',
  name: 'Guest',
  avatar_url: null,
};

export function isDesktopGuestMode(): boolean {
  return process.env.DESKTOP_GUEST_MODE === '1';
}
