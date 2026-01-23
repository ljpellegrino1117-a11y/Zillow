/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Use environment variable for backend URL in production, localhost for development
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
  // Output standalone for smaller deployment
  output: 'standalone',
}

module.exports = nextConfig
