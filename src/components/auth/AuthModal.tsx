'use client';

import { FormEvent, useState } from 'react';
import { X } from 'lucide-react';
import type { User as UserType } from '@/lib/types';

type AuthMode = 'login' | 'register';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: UserType, token: string) => void;
}

const isCloudDeploy = process.env.NEXT_PUBLIC_COZE_CLOUD === '1';

export function AuthModal({ isOpen, onClose, onLogin }: AuthModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');

  const submitCloudAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, username: username.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user || !data.token) {
        throw new Error(data.error || (authMode === 'login' ? '登录失败' : '注册失败'));
      }
      localStorage.setItem('auth_token', data.token);
      onLogin(data.user, data.token);
      setEmail('');
      setPassword('');
      setUsername('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-[420px] rounded-2xl border border-white/[0.08] bg-[#080812]/95 p-7 shadow-2xl shadow-black/40">
        <button onClick={onClose} className="absolute right-4 top-4 text-white/25 transition hover:text-white/60" type="button" aria-label="关闭">
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-white/90">{authMode === 'login' ? '登录账号' : '注册账号'}</h2>
          <p className="mt-1.5 text-xs leading-5 text-white/35">{isCloudDeploy ? '扣子云端版使用账号体系保存项目、图片和提示词资产。' : '使用账号登录，项目和资产保存在云端数据库。'}</p>
        </div>

        <form onSubmit={submitCloudAuth} className="space-y-3">
          {authMode === 'register' && (
            <label className="block space-y-1.5">
              <span className="text-[11px] text-white/45">用户名</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="你的昵称" className="h-10 w-full rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 text-sm text-white/85 outline-none placeholder:text-white/18 focus:border-violet-300/45" />
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-[11px] text-white/45">邮箱</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-10 w-full rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 text-sm text-white/85 outline-none placeholder:text-white/18 focus:border-violet-300/45" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] text-white/45">密码</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={authMode === 'register' ? '至少 6 个字符' : '输入密码'} required minLength={authMode === 'register' ? 6 : undefined} className="h-10 w-full rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 text-sm text-white/85 outline-none placeholder:text-white/18 focus:border-violet-300/45" />
          </label>

          {error && <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200/90">{error}</p>}

          <button type="submit" disabled={loading} className="mt-2 h-10 w-full rounded-xl bg-white text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-60">
            {loading ? '处理中...' : authMode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }} className="mt-4 w-full text-center text-xs text-white/45 transition hover:text-white/75">
          {authMode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
        </button>
      </div>
    </div>
  );
}
