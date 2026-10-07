import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // In Docker, Caddy routes /api before it reaches Next; this makes `next dev` work standalone.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/:path*` }];
  },
};

export default config;
