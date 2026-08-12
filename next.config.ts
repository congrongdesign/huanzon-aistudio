import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
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
    '*': ['release/**/*', 'tools/**/*'],
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
