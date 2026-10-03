import { describe, expect, it } from 'vitest';
import { isExcepted, licenseIsAllowed } from '../licenses-rules.ts';
import { yjsVersionsIn } from '../yjs-versions.ts';

describe('licenseIsAllowed', () => {
  it('accepts permissive licences', () => {
    for (const license of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', '0BSD']) {
      expect(licenseIsAllowed(license)).toBe(true);
    }
  });

  it('rejects copyleft and unknown licences', () => {
    for (const license of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'UNKNOWN', 'MPL-2.0']) {
      expect(licenseIsAllowed(license)).toBe(false);
    }
  });

  it('accepts an OR expression when one alternative is allowed', () => {
    expect(licenseIsAllowed('(MIT OR GPL-3.0)')).toBe(true);
    expect(licenseIsAllowed('(GPL-2.0 OR GPL-3.0)')).toBe(false);
  });

  it('needs every part of an AND expression to be allowed', () => {
    expect(licenseIsAllowed('(MIT AND BSD-3-Clause)')).toBe(true);
    expect(licenseIsAllowed('(MIT AND GPL-3.0)')).toBe(false);
  });
});

describe('isExcepted', () => {
  it('allows the named dev tool only with its exact licence', () => {
    expect(isExcepted('lightningcss', 'MPL-2.0')).toBe(true);
    expect(isExcepted('lightningcss-linux-x64-gnu', 'MPL-2.0')).toBe(true);
    expect(isExcepted('lightningcss', 'GPL-3.0')).toBe(false);
    expect(isExcepted('other-package', 'MPL-2.0')).toBe(false);
  });
});

describe('yjsVersionsIn', () => {
  it('collects distinct yjs versions and ignores peer suffixes and other packages', () => {
    const entries = [
      'yjs@13.6.33',
      'yjs@13.6.33_peer',
      'y-protocols@1.0.7_yjs@13.6.33',
      'lib0@0.2.1',
    ];
    expect(yjsVersionsIn(entries)).toEqual(['13.6.33']);
  });

  it('reports every version when there are several', () => {
    expect(yjsVersionsIn(['yjs@13.6.33', 'yjs@14.0.0-16'])).toEqual(['13.6.33', '14.0.0-16']);
  });
});
