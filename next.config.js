/**
 * @format
 * @type {import('next').NextConfig}
 */

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['192.168.1.240', 'localhost'],
  },
  serverRuntimeConfig: {
    PORT: process.env.PORT || 3000,
  },
  publicRuntimeConfig: {
    staticFolder: '/mnt/Truenas/truecloud/uploads',
  },
  // Increase request body size limit for file uploads (5GB)
  api: {
    bodyParser: {
      sizeLimit: false ,
    },
  },
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
