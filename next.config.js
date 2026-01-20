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
};

console.log('Next.js Configuration:');
console.log('- Image domains:', nextConfig?.images?.domains);
console.log('- Port:', nextConfig.serverRuntimeConfig.PORT);
console.log('- Environment:', process.env.NODE_ENV || 'development');
console.log('- Node version:', process.version);

module.exports = nextConfig;
