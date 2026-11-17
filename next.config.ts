import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.HZ_NEXT_DIST_DIR || '.next',
  output: 'standalone',
  // This SDK bundles its own require runtime; keep it intact in the Node server.
  serverExternalPackages: ['coze-coding-dev-sdk', '@libsql/client'],
  env: {
    NEXT_PUBLIC_COZE_CLOUD:
      process.env.NEXT_PUBLIC_COZE_CLOUD ??
      (process.env.COZE_PROJECT_ENV === 'PROD' || process.env.HZ_BACKEND_MODE === 'supabase' ? '1' : '0'),
  },
  experimental: {
    // Allow large PPT/ZIP uploads to pass through Next proxy/middleware layer.
    proxyClientMaxBodySize: '512mb',
  },
  allowedDevOrigins: ['*.dev.coze.site', 'localhost', '127.0.0.1', '*.local'],
  outputFileTracingExcludes: {
    '*': ['./release/**/*', './tools/**/*', './output/**/*', './.next/standalone/**/*', './.desktop-runtime/**/*', './docs/**/*', './skills/**/*', './.git/**/*'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
