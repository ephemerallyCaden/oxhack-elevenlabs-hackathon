import { describe, expect, it } from 'vitest';
import { forgetError, seatJury } from './seatJury';

const kept = { email: 'maya@x.com', name: 'Maya', key: 'k-maya' };
const server = (key: string, name?: string) => ({ email: '', key, name });

describe('seatJury', () => {
  it('seats each person once: a face kept on this laptop hides its server copy', () => {
    const seats = seatJury({ yours: [], roster: [kept], stored: [server('k-maya', 'Maya'), server('k-leo', 'Leo')] });
    expect(seats.map((s) => s.name)).toEqual(['Maya', 'Leo']);
    expect(seats[0].email).toBe('maya@x.com'); // the tappable laptop seat wins
  });

  it('hides your own server seat only while your new face is on show', () => {
    const you = [{ email: '', name: 'You', face: 'x' }];
    const stored = [server('k-me', 'Sam'), server('k-leo', 'Leo')];
    expect(seatJury({ yours: you, roster: [], stored, signedInAs: 'sam@x.com', myKey: 'k-me' }).map((s) => s.name)).toEqual(['You', 'Leo']);
    expect(seatJury({ yours: [], roster: [], stored, signedInAs: 'sam@x.com', myKey: 'k-me' }).map((s) => s.name)).toEqual(['Sam', 'Leo']);
    expect(seatJury({ yours: you, roster: [], stored }).map((s) => s.name)).toEqual(['You', 'Sam', 'Leo']); // not signed in: can't know
  });

  it('never hides another person’s seat, and keeps keyless entries', () => {
    const seats = seatJury({ yours: [], roster: [{ email: 'old@x.com', name: 'Old' }], stored: [server('k-a', 'A'), { email: '', name: 'Legacy' }] });
    expect(seats.map((s) => s.name)).toEqual(['Old', 'A', 'Legacy']);
  });
});

describe('forgetError', () => {
  it('tells an expired session to sign in again, anything else to retry', () => {
    expect(forgetError(401)).toMatch(/signed out/);
    expect(forgetError(500)).toMatch(/try again/);
    expect(forgetError(undefined)).toMatch(/try again/);
  });
});
