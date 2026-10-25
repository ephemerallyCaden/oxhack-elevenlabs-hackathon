import { describe, expect, it } from 'vitest';
import { plain, unlabel } from './trial';

describe('speaker labels', () => {
  it('strips a leading speaker label from display text', () => {
    expect(plain('Judge: Consider the money.')).toBe('Consider the money.');
    expect(plain('PROSECUTION (YES): I won.')).toBe('I won.');
  });

  it('keeps leading audio tags in tts while dropping the label', () => {
    expect(unlabel('[calm] The Judge: Order!')).toBe('[calm] Order!');
  });

  it('leaves sentences that merely mention a role alone', () => {
    expect(plain('Judge Judy said hi.')).toBe('Judge Judy said hi.');
    expect(plain('The judge’s ruling stands: no.')).toBe('The judge’s ruling stands: no.');
  });
});
