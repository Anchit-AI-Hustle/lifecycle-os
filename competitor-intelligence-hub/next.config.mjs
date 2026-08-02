/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // imapflow / mailparser / googleapis are Node-only libraries. Keep them external
    // so Next does not bundle their native/optional deps into the serverless function.
    serverComponentsExternalPackages: ["imapflow", "mailparser", "googleapis"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "drive.google.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
