import { describe, expect, it } from 'vitest';
import { mergeProfile, mockProfile } from './mock';
import { extractProfile } from './trial';

// Speech-to-text of an onboarding recording: run-on sentences, filler, lowercase.
const TRANSCRIPT =
  "my name is priya and today I'm putting my future on trial. um so I'm 18 and I live in Leeds with my mum and my little brother. " +
  "a normal day is college then a shift at the cafe. honestly I plan everything, I'm pretty careful with money because we don't have loads. " +
  "the best day this year was getting my offer from Manchester. the thing I'm wrestling with is whether to take a gap year before uni or go straight in.";

describe('profile extraction (offline)', () => {
  it('pulls out the facts people state plainly', () => {
    const { profile, fallback } = mockProfile({ transcript: TRANSCRIPT });
    expect(fallback).toBe(true);
    expect(profile).toMatchObject({ name: 'Priya', age: 18, location: 'Leeds', risk_tolerance: 'cautious' });
  });

  it('turns the decision they describe into a "Should I …?" question', () => {
    expect(mockProfile({ transcript: TRANSCRIPT }).question).toBe('Should I take a gap year before uni or go straight in?');
    expect(mockProfile({ transcript: 'should I move to Berlin for the job' }).question).toBe('Should I move to Berlin for the job?');
  });

  it('reads per-question answers too', () => {
    const { profile } = mockProfile({
      answers: [
        { question: 'What is your name, age and where do you live?', transcript: "I'm Tom, I'm 35 and I live in Bristol" },
        { question: 'When you take a risk?', transcript: 'I just go for it, always have' },
      ],
    });
    expect(profile).toMatchObject({ age: 35, location: 'Bristol', risk_tolerance: 'bold' });
  });

  it('never guesses: nothing said → nothing filled', () => {
    const { profile, question } = mockProfile({ transcript: 'hello hello is this working' });
    expect(profile).toEqual({});
    expect(question).toBeUndefined();
  });

  it('ignores ages that are not ages', () => {
    expect(mockProfile({ transcript: "I'm 4 hours from home" }).profile.age).toBeUndefined();
  });
});

describe('mergeProfile', () => {
  it('lets typed form fields win over extracted ones, ignoring empty values', () => {
    const merged = mergeProfile({ age: 81, location: 'Leeds', situation: 'student' }, { age: 18, location: '', values: [] });
    expect(merged).toEqual({ age: 18, location: 'Leeds', situation: 'student' });
  });
});

describe('extractProfile (server)', () => {
  it('falls back to the offline extractor when there is no key, keeping the form', async () => {
    const r = await extractProfile({ transcript: TRANSCRIPT, form: { situation: 'sixth-form student' } });
    expect(r.profile).toMatchObject({ name: 'Priya', age: 18, situation: 'sixth-form student' });
    expect(r.question).toMatch(/^Should I take a gap year/);
  });

  it('returns just the form when nothing was recorded', async () => {
    const r = await extractProfile({ transcript: '', form: { age: 20 } });
    expect(r).toEqual({ profile: { age: 20 }, fallback: true });
  });
});

describe('plain (display text)', () => {
  it('strips audio tags the model leaked into display text', async () => {
    const { plain } = await import('./trial');
    expect(plain('[authoritative] The court finds… [sighs] for YES.')).toBe('The court finds… for YES.');
    expect(plain('No tags here.')).toBe('No tags here.');
  });
});
