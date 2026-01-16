/**
 * @format
 * @type {import('next').NextConfig}
 */

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
  },
  serverRuntimeConfig: {
    PORT: process.env.PORT || 3000,
  },
  publicRuntimeConfig: {
    staticFolder: '/public',
  },
};

module.exports = nextConfig;
