import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../src/origin';

const allowed = ['https://app.example.com', 'http://localhost:4217'];

describe('isOriginAllowed', () => {
  it('lets clients without an origin header through', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it('accepts listed origins', () => {
    expect(isOriginAllowed('https://app.example.com', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:4217', allowed)).toBe(true);
  });

  it('rejects other hosts, ports and schemes', () => {
    expect(isOriginAllowed('https://evil.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:4218', allowed)).toBe(false);
    expect(isOriginAllowed('http://app.example.com', allowed)).toBe(false);
  });

  it('rejects the opaque and malformed origins', () => {
    expect(isOriginAllowed('null', allowed)).toBe(false);
    expect(isOriginAllowed('', allowed)).toBe(false);
  });

  it('accepts everything for the wildcard', () => {
    expect(isOriginAllowed('https://anything.example', ['*'])).toBe(true);
    expect(isOriginAllowed('null', ['*'])).toBe(true);
  });
});
