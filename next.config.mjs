/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Playwright must never be bundled into the Next.js server build.
  serverExternalPackages: ["playwright", "@prisma/client"],
};

export default nextConfig;
