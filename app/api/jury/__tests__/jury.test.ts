// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const big = await sharp({ create: { width: 496, height: 574, channels: 4, background: { r: 200, g: 150, b: 120, alpha: 1 } } }).png().toBuffer();
const face = `data:image/png;base64,${big.toString('base64')}`;
vi.mock('@/lib/users/store', () => ({
  listFaces: async () => [
    { name: 'Maya', selfie: face },
    { name: undefined, selfie: face },
    { name: 'Broken', selfie: 'data:image/png;base64,not-an-image' },
  ],
}));
const { POST } = await import('../route');

describe('/api/jury', () => {
  it('returns small thumbnails and first names only', async () => {
    const { jurors } = await (await POST()).json();
    expect(jurors).toHaveLength(2); // the unreadable face is dropped
    expect(jurors[0].name).toBe('Maya');
    expect(Object.keys(jurors[0]).sort()).toEqual(['face', 'name']);
    const meta = await sharp(Buffer.from(jurors[0].face.split(',')[1], 'base64')).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.height).toBe(112);
    expect(jurors[0].face.length).toBeLessThan(face.length / 3);
  });
});
