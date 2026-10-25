// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const png = async (w: number, h: number) =>
  `data:image/png;base64,${(await sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 150, b: 120, alpha: 1 } } }).png().toBuffer()).toString('base64')}`;
const face = await png(496, 574);
const bomb = await png(4000, 4000); // 16 MP: over the decode limit

const listFaces = vi.fn();
vi.mock('@/lib/users/store', () => ({ listFaces: (...a: unknown[]) => listFaces(...a) }));
const { POST } = await import('../route');
const { invalidateJury, juryKey } = await import('@/lib/users/jury');

beforeEach(() => {
  listFaces.mockReset();
  invalidateJury();
});

describe('/api/jury', () => {
  it('returns small thumbnails, first names and an opaque key only', async () => {
    listFaces.mockResolvedValue([
      { id: 'u-1', name: 'Maya', selfie: face },
      { id: 'u-2', name: undefined, selfie: face },
    ]);
    const { jurors } = await (await POST()).json();
    expect(jurors).toHaveLength(2);
    expect(jurors[0]).toEqual({ key: juryKey('u-1'), name: 'Maya', face: expect.stringMatching(/^data:image\/webp;base64,/) });
    expect(jurors[0].key).not.toContain('u-1');
    const meta = await sharp(Buffer.from(jurors[0].face.split(',')[1], 'base64')).metadata();
    expect(meta.height).toBe(112);
  });

  it('drops faces it must not decode: SVG, unreadable data, decompression bombs', async () => {
    listFaces.mockResolvedValue([
      { id: 'a', name: 'Svg', selfie: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { id: 'b', name: 'Broken', selfie: 'data:image/png;base64,not-an-image' },
      { id: 'c', name: 'Bomb', selfie: bomb },
      { id: 'd', name: 'Ok', selfie: face },
    ]);
    const { jurors } = await (await POST()).json();
    expect(jurors.map((j: { name: string }) => j.name)).toEqual(['Ok']);
  });

  it('caches for a minute, shares one rebuild between concurrent requests, and rebuilds once invalidated', async () => {
    listFaces.mockResolvedValue([{ id: 'u-1', name: 'Maya', selfie: face }]);
    await Promise.all([POST(), POST(), POST()]);
    await POST();
    expect(listFaces).toHaveBeenCalledTimes(1);
    invalidateJury(); // a save or "Forget me"
    listFaces.mockResolvedValue([]);
    expect((await (await POST()).json()).jurors).toEqual([]);
    expect(listFaces).toHaveBeenCalledTimes(2);
  });

  it('never breaks the menu: a store failure is an empty jury', async () => {
    listFaces.mockRejectedValue(new Error('db down'));
    expect((await (await POST()).json()).jurors).toEqual([]);
  });
});
