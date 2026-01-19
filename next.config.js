/**
 * @format
 * @type {import('next').NextConfig}
 */

const nextConfig = {
  reactStrictMode: true,
  images: {
	  domains: ['192.168.1.240',"localhost"],
  },
  serverRuntimeConfig: {
    PORT: process.env.PORT || 3000,
  },
  publicRuntimeConfig: {
    staticFolder: '/mnt/Truenas/truecloud/uploads',
  },
};


console.log(nextConfig?.images?.domains)
module.exports = nextConfig;
