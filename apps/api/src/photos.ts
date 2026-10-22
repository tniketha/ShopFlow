import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from './domain.js';

export const photoChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('automatic') }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('library'),
      key: z.enum(['rice', 'tea', 'milk', 'coffee', 'sugar', 'soap', 'biscuits', 'oil', 'water']),
    })
    .strict(),
  z.object({ kind: z.literal('upload'), data: z.string().min(1).max(720_000) }).strict(),
]);

export async function preparePhoto(choice: z.infer<typeof photoChoice> | undefined) {
  if (!choice) return undefined;
  if (choice.kind !== 'upload')
    return {
      photoKey: choice.kind === 'automatic' ? null : choice.kind === 'none' ? 'none' : choice.key,
      photoVersion: null,
      content: null,
    };
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(choice.data);
  if (!match || match[2]!.length % 4 !== 0)
    throw new AppError(400, 'Choose a JPEG, PNG or WebP photo');
  const input = Buffer.from(match[2]!, 'base64');
  if (input.length > 524288) throw new AppError(400, 'Photo must be smaller than 512 KB');
  try {
    const image = sharp(input, {
      limitInputPixels: 20_000_000,
      animated: false,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
      throw new Error('Unsupported image');
    // Re-encode pixels to strip metadata, embedded payloads and original file names.
    const content = await image
      .rotate()
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer();
    if (content.length > 524288) throw new Error('Image too large');
    return { photoKey: 'custom', photoVersion: crypto.randomUUID(), content };
  } catch {
    throw new AppError(400, 'Photo could not be read. Choose a valid JPEG, PNG or WebP image');
  }
}
