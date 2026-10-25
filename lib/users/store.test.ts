// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const rows = [
  { id: 'a', profile: { name: 'Maya Patel' }, selfie: 'data:image/png;base64,AA' },
  { id: 'b', profile: { name: 123 }, selfie: 'data:image/png;base64,AA' },
  { id: 'c', profile: { name: 'Averyveryveryverylongfirstnamethatgoesonandon' }, selfie: 'data:image/png;base64,AA' },
  { id: 'd', profile: {}, selfie: JSON.stringify({ front: { src: 'data:image/png;base64,BB' }, side: { src: 'x' } }) },
];
vi.mock('@/lib/supabase', () => ({
  LOCAL_DIR: '/tmp/unused',
  supabase: { from: () => ({ select: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }) }) }) },
}));
const { listFaces } = await import('./store');

describe('listFaces (the jury source)', () => {
  it('keeps first names only, survives a non-text name, caps the length, unpacks both-head rows', async () => {
    const faces = await listFaces(15);
    expect(faces.map((f) => f.name)).toEqual(['Maya', undefined, 'Averyveryveryverylon', undefined]);
    expect(faces[3].selfie).toBe('data:image/png;base64,BB');
    expect(faces.every((f) => f.id)).toBe(true);
  });
});
