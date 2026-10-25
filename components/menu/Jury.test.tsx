import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Jury from './Jury';

const maya = { email: 'maya@x.com', name: 'Maya', face: 'data:image/webp;base64,AA' };
const leo = { email: 'leo@x.com', name: 'Leo' };

afterEach(cleanup);

describe('Jury', () => {
  it('seats kept faces in the middle of the front pew; empty seats are silhouettes', () => {
    const { container } = render(<Jury roster={[maya, leo]} />);
    const front = [...container.querySelectorAll('.jury-front .jury-heads > *')];
    expect(front).toHaveLength(8);
    const kept = front.map((el, i) => (el.classList.contains('kept') ? i : -1)).filter((i) => i >= 0);
    expect(kept).toEqual([3, 4]);
    expect(container.querySelectorAll('.juror.empty')).toHaveLength(15 - 2);
    expect(screen.getByText('Maya')).toBeTruthy();
  });

  it('tapping a face signs in as that person; × only removes it from this laptop', () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();
    render(<Jury roster={[maya]} onPick={onPick} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in as Maya' }));
    expect(onPick).toHaveBeenCalledWith(maya);
    fireEvent.click(screen.getByRole('button', { name: /^Remove Maya from this laptop/ }));
    expect(onRemove).toHaveBeenCalledWith(maya);
  });

  it('your own new face (no account yet) sits in the jury but is not a button', () => {
    render(<Jury roster={[{ email: '', name: 'You', face: 'x' }]} onPick={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('marks the signed-in juror and shows only the front pew when compact', () => {
    const { container } = render(<Jury roster={[maya]} signedInAs="maya@x.com" onPick={vi.fn()} compact />);
    expect(container.querySelector('.juror.me')).toBeTruthy();
    // Your own seat isn't a button (tapping it would do nothing): no "Sign in as Maya" while signed in as Maya.
    expect(screen.queryByRole('button', { name: /Sign in as Maya/ })).toBeNull();
    expect(container.querySelector('.jury-back')).toBeNull();
  });
});

describe('Jury stored faces', () => {
  it('shows a stored face without a name as a plain juror (no empty nameplate, not clickable)', () => {
    const { container } = render(<Jury roster={[{ email: '', face: 'x' }]} onPick={vi.fn()} onRemove={vi.fn()} />);
    expect(container.querySelectorAll('.juror.kept')).toHaveLength(1);
    expect(container.querySelectorAll('.juror-plate')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
