import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'ShopFlow | Store workspace',
  description: 'Inventory, purchases and checkout in one store workspace.',
  authors: [{ name: 'tniketha' }],
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
