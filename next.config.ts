import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: {
    remotePatterns: [
      // OSS avatar storage (MinIO / R2 / S3)
      ...(process.env.OSS_PUBLIC_URL
        ? [
            {
              protocol: new URL(process.env.OSS_PUBLIC_URL).protocol.replace(":", "") as "http" | "https",
              hostname: new URL(process.env.OSS_PUBLIC_URL).hostname,
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
