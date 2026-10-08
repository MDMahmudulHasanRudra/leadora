import { normalizeEmail, normalizePhone } from './normalize';

describe('normalizePhone (default country BD)', () => {
  it.each([
    ['01712-345678', '+8801712345678'],
    ['01712 345 678', '+8801712345678'],
    ['+880 1712-345678', '+8801712345678'],
    ['008801712345678', '+8801712345678'],
    ['+44 7911 123456', '+447911123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input, 'BD')).toBe(expected);
  });

  it.each(['abc', '123', '+1', ''])('rejects %j', (input) => {
    expect(normalizePhone(input, 'BD')).toBeNull();
  });

  it('uses the organization country for local numbers', () => {
    expect(normalizePhone('07911 123456', 'GB')).toBe('+447911123456');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Rahim@Acme.COM ')).toBe('rahim@acme.com');
  });
});
