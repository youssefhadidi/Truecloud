/**
 * @format
 * @type {import('next').NextConfig}
 */

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    proxyClientMaxBodySize: '100gb',
  },
  images: {
    domains: ['192.168.1.240', 'localhost'],
  },
  serverRuntimeConfig: {
    PORT: process.env.PORT || 3000,
  },
  publicRuntimeConfig: {
    staticFolder: '/mnt/Truenas/truecloud/uploads',
  },

  // Enable compression (gzip + Brotli for production)
  // Brotli typically achieves 15-20% better compression than gzip
  compress: true,

  // Enable more detailed logging
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  // Increase build verbosity
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  // Configure Turbopack for Next.js 16 (default bundler)
  turbopack: {
    resolveAlias: {
      // Use a stub for webtorrent during build - real module is lazy-loaded at runtime
      webtorrent: '@/lib/webtorrent-stub',
    },
  },
  // Webpack config for fallback if webpack is explicitly used
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      // Mark webtorrent as external so it's not bundled during build
      if (!config.externals.includes('webtorrent')) {
        config.externals.push('webtorrent');
      }
    }
    return config;
  },
  // Add headers for cache busting and security
  async headers() {
    const buildId = process.env.NEXT_BUILD_ID || new Date().getTime().toString();
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'X-App-Version',
            value: buildId,
          },
        ],
      },
      // Cache static assets aggressively
      {
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Cache next internal files with version
      {
        source: '/_next/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

console.log('Next.js Configuration:');
console.log('- Image domains:', nextConfig?.images?.domains);
console.log('- Port:', nextConfig.serverRuntimeConfig.PORT);
console.log('- Environment:', process.env.NODE_ENV || 'development');
console.log('- Node version:', process.version);

module.exports = nextConfig;
