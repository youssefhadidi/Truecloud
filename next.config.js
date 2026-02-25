/**
 * @format
 * @type {import('next').NextConfig}
 */

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    proxyClientMaxBodySize: '100gb',
    optimizePackageImports: [
      'three',
      'react-icons',
      '@reduxjs/toolkit',
      'react-redux',
      'date-fns',
    ],
  },
  serverExternalPackages: ['webtorrent', 'xlsx', '@prisma/client', 'prisma'],
  images: {
    remotePatterns: [{ hostname: '192.168.1.240' }, { hostname: 'localhost' }],
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
  // Webpack config (used when --webpack flag is passed explicitly)
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (!config.externals.includes('webtorrent')) {
        config.externals.push('webtorrent');
      }
    }
    return config;
  },
  productionBrowserSourceMaps: false,
  turbopack: {
    memoryLimit: 1 * 1024 * 1024 * 1024, // 1 GB cap
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

if (process.env.NODE_ENV !== 'production') {
  console.log('Next.js Configuration:');
  console.log(
    '- Image patterns:',
    nextConfig?.images?.remotePatterns?.map((p) => p.hostname),
  );
  console.log('- Port:', process.env.PORT || 3000);
  console.log('- Environment:', process.env.NODE_ENV || 'development');
  console.log('- Node version:', process.version);
}

module.exports = nextConfig;
