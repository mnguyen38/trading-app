/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Reuse a visited page's data for 30s on back/forward and repeat nav clicks
    // instead of refetching immediately. AutoRefresh still forces fresh data.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
