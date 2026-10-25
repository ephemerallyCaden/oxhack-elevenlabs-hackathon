import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VerdictScreen from './VerdictScreen';
import type { Transcript } from '@/types';

const t = { question: 'Should I?', lines: [], sources: [], verdict: { spectrum: { value: 50, label: 'Strong yes' }, explanation: 'Because.', breakdown: [], line: { id: 'v', speaker: 'judge', kind: 'verdict', text: '', cites: [] } } } as unknown as Transcript;
const poses = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-role]')].map((e) => `${e.dataset.role}:${e.dataset.pose}`);

// jsdom has no ResizeObserver (Seam sizes the lawyers with it).
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });

afterEach(cleanup);

describe('VerdictScreen', () => {
  it('the court’s label decides who gloats: strong → the loser breaks down, lean → sweats, toss-up → both sweat', () => {
    expect(poses(render(<VerdictScreen transcript={t} value={50} label="Strong yes" onLeave={vi.fn()} />).container)).toEqual(['prosecution:confident2', 'defense:breakdown1']);
    cleanup();
    expect(poses(render(<VerdictScreen transcript={t} value={-25} label="Lean no" onLeave={vi.fn()} />).container)).toEqual(['prosecution:sweating2', 'defense:confident2']);
    cleanup();
    expect(poses(render(<VerdictScreen transcript={t} value={13} label="Toss-up" onLeave={vi.fn()} />).container)).toEqual(['prosecution:sweating1', 'defense:sweating1']);
  });

  it('starts on New case, and the record drawer opens and closes (button, its own Close, Escape)', () => {
    const onLeave = vi.fn();
    const { container } = render(<VerdictScreen transcript={t} value={50} label="Strong yes" onLeave={onLeave} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New case' }));
    const strip = () => container.querySelector('.seam-strip')!;
    expect(strip().classList.contains('open')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Read the court record' }));
    expect(strip().classList.contains('open')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Close the court record ✕/ }));
    expect(strip().classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Read the court record' })); // focus comes back
    fireEvent.click(screen.getByRole('button', { name: 'Read the court record' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(strip().classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Read the court record' }));
    fireEvent.click(screen.getByRole('button', { name: 'New case' }));
    expect(onLeave).toHaveBeenCalledWith('/?again=1');
    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));
    expect(onLeave).toHaveBeenCalledWith('/');
  });
});
