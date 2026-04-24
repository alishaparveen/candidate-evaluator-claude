/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['googleapis', 'google-auth-library'],
};

module.exports = nextConfig;
