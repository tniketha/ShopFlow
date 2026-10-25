'use client';
import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
export const libraryPhotos = [
  ['rice', 'Rice'],
  ['tea', 'Tea'],
  ['milk', 'Milk'],
  ['coffee', 'Coffee'],
  ['sugar', 'Sugar'],
  ['soap', 'Soap'],
  ['biscuits', 'Biscuits'],
  ['oil', 'Coconut oil'],
  ['water', 'Water'],
];
function automaticKey(name) {
  const patterns = [
    ['rice', /\brice\b/i],
    ['tea', /\btea\b/i],
    ['milk', /\bmilk\b/i],
    ['coffee', /\bcoffee\b/i],
    ['sugar', /\bsugar\b/i],
    ['soap', /\bsoap\b/i],
    ['biscuits', /\b(biscuits?|cookies?)\b/i],
    ['oil', /\bcoconut\s+oil\b/i],
    ['water', /\b(drinking|mineral|spring)\s+water\b/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(name))?.[0];
}
export function photoSource(product) {
  const key = automaticKey(product.name);
  return libraryPhotos.some(([id]) => id === key) ? `/images/products/${key}.jpg` : undefined;
}
export function ProductPhoto({ product, large = false }) {
  const src = photoSource(product);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={'product-photo' + (large ? ' large' : '')} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <Package size={large ? 30 : 20} />
      )}
    </span>
  );
}
