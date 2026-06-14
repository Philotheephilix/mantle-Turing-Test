/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: [
    "@nexus/core",
    "@nexus/react",
    "@nexus/types",
    "@nexus/backend",
    "@nexus/relayer",
    "@nexus/server",
    "@nexus/secrets",
  ],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
