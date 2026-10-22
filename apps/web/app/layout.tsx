import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'ShopFlow | Store workspace',
  description: 'Inventory, purchases and checkout in one store workspace.',
  authors: [{ name: 'tniketha' }],
  applicationName: 'ShopFlow',
  icons: {
    icon: [
      { url: '/brand/shopflow-mark.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    shortcut: '/brand/favicon-32.png',
    apple: { url: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
