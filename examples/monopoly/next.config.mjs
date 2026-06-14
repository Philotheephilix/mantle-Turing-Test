/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // The @nexus/* workspace packages ship ESM; transpile them for the server bundle.
  transpilePackages: ["@nexus/core", "@nexus/backend", "@nexus/react", "@nexus/relayer", "@nexus/server", "@nexus/types"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
