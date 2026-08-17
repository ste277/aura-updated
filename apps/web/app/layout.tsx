import type { Metadata, Viewport } from 'next';
import './tokens.css';

export const metadata: Metadata = {
  title: 'AuraSchedule',
  description: 'Solar Timing & Panchang Productivity System',
  // Without this link browsers never discover the manifest, so the PWA is
  // not installable even though public/manifest.json exists.
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#090d16',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}