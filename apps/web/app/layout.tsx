import type { Metadata, Viewport } from 'next';
import './tokens.css';

export const metadata: Metadata = {
  title: 'AuraSchedule',
  description: 'Solar Timing & Panchang Productivity System',
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