import PDFDocument from 'pdfkit';
import { formatMoney } from './domain.js';
export function makePdf(title: string, rows: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({
      margin: 48,
      info: { Title: title, Author: 'tniketha', Creator: 'ShopFlow' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(22).text('ShopFlow').moveDown(0.3);
    doc.fontSize(14).text(title).moveDown();
    doc.fontSize(10);
    for (const row of rows) {
      if (doc.y > 720) doc.addPage();
      doc.text(row, { width: 490 }).moveDown(0.3);
    }
    doc.end();
  });
}
export function invoicePdf(
  business: string,
  sale: {
    invoiceNo: number;
    createdAt: Date;
    totalMinor: number;
    paidMinor: number;
    lines: {
      name: string;
      sku: string;
      quantity: number;
      priceMinor: number;
      returnedQuantity: number;
    }[];
  },
) {
  return makePdf(`Invoice SF-${String(sale.invoiceNo).padStart(8, '0')}`, [
    business,
    sale.createdAt.toLocaleString('en-GB', { timeZone: 'Asia/Colombo' }) + ' (Sri Lanka)',
    ...sale.lines.map(
      (l) =>
        `${l.sku} | ${l.name} | ${l.quantity} x ${formatMoney(l.priceMinor)} = ${formatMoney(l.quantity * l.priceMinor)}${l.returnedQuantity ? ` | returned: ${l.returnedQuantity}` : ''}`,
    ),
    `Original sale total: ${formatMoney(sale.totalMinor)}`,
    `Cash received: ${formatMoney(sale.paidMinor)}`,
    `Change: ${formatMoney(sale.paidMinor - sale.totalMinor)}`,
    'Payment method: CASH',
    'Refunds are recorded separately against this invoice.',
  ]);
}
