/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // The published SDK packages are ESM; transpile them so Next handles them the
  // same in dev and production.
  transpilePackages: ["@steamlink/core", "@steamlink/types", "@steamlink/relayer", "@steamlink/secrets"],
  webpack: (config, { nextRuntime }) => {
    // `instrumentation.ts` boots the game backends (which read/write the funded
    // player keys via `fs`). Next compiles instrumentation for BOTH the nodejs and
    // edge runtimes; only the nodejs one actually runs it (it's gated on
    // NEXT_RUNTIME === "nodejs"). On the edge + client builds the node builtins are
    // unavailable, so stub them to empty modules — the code there is never executed.
    if (nextRuntime !== "nodejs") {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        url: false,
        os: false,
        crypto: false,
        stream: false,
      };
    }
    return config;
  },
};

export default nextConfig;
