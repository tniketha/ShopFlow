'use client';
import { useEffect, useState } from 'react';
import { ImagePlus, Package } from 'lucide-react';

export type PhotoProduct = {
  id: string;
  name: string;
  photoKey?: string | null;
  photoVersion?: string | null;
};
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
] as const;
function automaticKey(name: string) {
  const patterns: [string, RegExp][] = [
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
export function photoSource(product: PhotoProduct) {
  if (product.photoKey === 'none') return undefined;
  if (product.photoKey === 'custom')
    return `/api/products/${product.id}/photo?v=${encodeURIComponent(product.photoVersion ?? '')}`;
  const key = product.photoKey ?? automaticKey(product.name);
  return libraryPhotos.some(([id]) => id === key) ? `/images/products/${key}.jpg` : undefined;
}
export function ProductPhoto({
  product,
  large = false,
}: {
  product: PhotoProduct;
  large?: boolean;
}) {
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
export function PhotoPicker({
  product,
  onProcessing,
}: {
  product?: PhotoProduct;
  onProcessing: (processing: boolean) => void;
}) {
  const [selection, setSelection] = useState('keep');
  const [upload, setUpload] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const choice =
    selection === 'keep'
      ? ''
      : JSON.stringify(
          selection === 'upload'
            ? { kind: 'upload', data: upload }
            : ['automatic', 'none'].includes(selection)
              ? { kind: selection }
              : { kind: 'library', key: selection },
        );
  const preview =
    selection === 'upload'
      ? upload
      : selection === 'keep'
        ? product
          ? photoSource(product)
          : undefined
        : selection === 'automatic' || selection === 'none'
          ? undefined
          : `/images/products/${selection}.jpg`;
  return (
    <fieldset className="photo-picker">
      <legend>Product photo</legend>
      <input type="hidden" name="photo" value={choice} />
      <div className="photo-preview">
        {preview ? <img src={preview} alt="Selected product photo" /> : <ImagePlus size={28} />}
        <div>
          <strong>A clearer view of your stock</strong>
          <p>Choose a reference photo or add your actual product.</p>
        </div>
      </div>
      <label>
        Photo style
        <select
          value={selection}
          disabled={processing}
          onChange={(e) => {
            setSelection(e.target.value);
            setError('');
          }}
        >
          <option value="keep">
            {product ? 'Keep current photo' : 'Automatic reference photo'}
          </option>
          <option value="automatic">Automatic reference photo</option>
          <option value="none">No photo</option>
          {libraryPhotos.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
          {upload && <option value="upload">Uploaded photo</option>}
        </select>
      </label>
      <div className="photo-options" role="group" aria-label="Reference photos">
        {libraryPhotos.map(([key, name]) => (
          <button
            type="button"
            key={key}
            aria-label={'Use ' + name.toLowerCase() + ' photo'}
            aria-pressed={selection === key}
            disabled={processing}
            onClick={() => {
              setSelection(key);
              setError('');
            }}
          >
            <img src={'/images/products/' + key + '.jpg'} alt="" loading="lazy" />
            <span>{name}</span>
          </button>
        ))}
      </div>
      <label className="upload-label">
        {processing ? 'Preparing photo…' : 'Upload your own photo'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={processing}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setError('');
            if (
              !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
              file.size > 8 * 1024 * 1024
            ) {
              setError('Choose a JPEG, PNG or WebP file smaller than 8 MB.');
              return;
            }
            setProcessing(true);
            onProcessing(true);
            let bitmap: ImageBitmap | undefined;
            try {
              bitmap = await createImageBitmap(file);
              if (bitmap.width * bitmap.height > 20_000_000)
                throw new Error('Use a photo smaller than 20 megapixels.');
              const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(bitmap.width * scale));
              canvas.height = Math.max(1, Math.round(bitmap.height * scale));
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Your browser could not prepare this photo.');
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              const data = canvas.toDataURL('image/jpeg', 0.8);
              if (data.length > 700_000) throw new Error('Choose a smaller or simpler photo.');
              setUpload(data);
              setSelection('upload');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Photo could not be opened.');
            } finally {
              bitmap?.close();
              setProcessing(false);
              onProcessing(false);
            }
          }}
        />
      </label>
      <p className="hint">
        JPEG, PNG or WebP · up to 8 MB. Photos are optimized before saving. Reference photos
        illustrate a product type; upload your own for exact packaging.
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}
