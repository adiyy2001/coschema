import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  createTokenVerifier,
  isValidColor,
  isValidName,
  signToken,
  type TokenIdentity,
} from '../src/auth';

const SECRET = 'a-test-secret-with-enough-length';
const NOW = new Date('2026-10-03T12:00:00Z');
const identity: TokenIdentity = { sub: 'anna', name: 'Anna', color: '#1b9e77', room: 'plant' };
const verify = createTokenVerifier({ secret: SECRET, now: () => NOW });
const key = new TextEncoder().encode(SECRET);

async function customToken(
  claims: Record<string, unknown>,
  configure: (jwt: SignJWT) => SignJWT = (jwt) => jwt,
  alg = 'HS256',
): Promise<string> {
  const seconds = Math.floor(NOW.getTime() / 1000);
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuer('coschema')
    .setAudience('coschema')
    .setIssuedAt(seconds)
    .setExpirationTime(seconds + 600);
  return configure(jwt).sign(key);
}

const validClaims = { name: 'Anna', color: '#1b9e77', room: 'plant' };

describe('token verification', () => {
  it('accepts a valid token and returns the identity', async () => {
    const token = await signToken(identity, { secret: SECRET, now: () => NOW });
    expect(await verify(token, 'plant')).toEqual({ ok: true, identity });
  });

  it('accepts a token that expired within the clock tolerance', async () => {
    const token = await signToken(identity, { secret: SECRET, now: () => NOW, ttlSeconds: 60 });
    const later = createTokenVerifier({
      secret: SECRET,
      now: () => new Date(NOW.getTime() + 64_000),
    });
    expect((await later(token, 'plant')).ok).toBe(true);
  });

  it('rejects an expired token', async () => {
    const token = await signToken(identity, { secret: SECRET, now: () => NOW, ttlSeconds: 60 });
    const later = createTokenVerifier({
      secret: SECRET,
      now: () => new Date(NOW.getTime() + 120_000),
    });
    expect(await later(token, 'plant')).toEqual({ ok: false, reason: 'invalid token' });
  });

  it('rejects a wrong signature', async () => {
    const token = await signToken(identity, {
      secret: 'another-secret-of-enough-length',
      now: () => NOW,
    });
    expect(await verify(token, 'plant')).toEqual({ ok: false, reason: 'invalid token' });
  });

  it('rejects alg none', async () => {
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
    const seconds = Math.floor(NOW.getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        ...validClaims,
        sub: 'anna',
        iss: 'coschema',
        aud: 'coschema',
        exp: seconds + 600,
      }),
    ).toString('base64url');
    expect((await verify(`${header}.${payload}.`, 'plant')).ok).toBe(false);
  });

  it('rejects another HMAC algorithm', async () => {
    const token = await customToken(validClaims, (jwt) => jwt.setSubject('anna'), 'HS512');
    expect((await verify(token, 'plant')).ok).toBe(false);
  });

  it('rejects a token for another room', async () => {
    const token = await signToken(identity, { secret: SECRET, now: () => NOW });
    expect(await verify(token, 'other')).toEqual({
      ok: false,
      reason: 'token is for another room',
    });
  });

  it('rejects the wrong audience and the wrong issuer', async () => {
    const wrongAudience = await signToken(identity, {
      secret: SECRET,
      now: () => NOW,
      audience: 'someone-else',
    });
    const wrongIssuer = await signToken(identity, {
      secret: SECRET,
      now: () => NOW,
      issuer: 'someone-else',
    });
    expect((await verify(wrongAudience, 'plant')).ok).toBe(false);
    expect((await verify(wrongIssuer, 'plant')).ok).toBe(false);
  });

  it('rejects missing or empty input', async () => {
    expect((await verify('', 'plant')).ok).toBe(false);
    expect((await verify('not.a.jwt', 'plant')).ok).toBe(false);
    expect((await verify('garbage', 'plant')).ok).toBe(false);
  });

  it('rejects a token without an expiry', async () => {
    const token = await new SignJWT(validClaims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('anna')
      .setIssuer('coschema')
      .setAudience('coschema')
      .sign(key);
    expect((await verify(token, 'plant')).ok).toBe(false);
  });

  it.each([
    ['a missing name', { color: '#1b9e77', room: 'plant' }],
    ['a missing color', { name: 'Anna', room: 'plant' }],
    ['a missing room', { name: 'Anna', color: '#1b9e77' }],
    ['a color that is not a hex triplet', { ...validClaims, color: 'red' }],
    ['a blank name', { ...validClaims, name: '   ' }],
    ['a name that is too long', { ...validClaims, name: 'n'.repeat(65) }],
    ['a name that is not a string', { ...validClaims, name: 7 }],
    ['an empty room', { ...validClaims, room: '' }],
  ])('rejects %s', async (_label, claims) => {
    const token = await customToken(claims, (jwt) => jwt.setSubject('anna'));
    expect(await verify(token, 'plant')).toEqual({
      ok: false,
      reason: expect.any(String) as string,
    });
  });

  it('rejects a token without a subject', async () => {
    const token = await customToken(validClaims);
    expect((await verify(token, 'plant')).ok).toBe(false);
  });
});

describe('identity helpers', () => {
  it('validates colors', () => {
    expect(isValidColor('#a1B2c3')).toBe(true);
    expect(isValidColor('#abc')).toBe(false);
    expect(isValidColor('a1b2c3')).toBe(false);
  });

  it('validates names', () => {
    expect(isValidName('Anna')).toBe(true);
    expect(isValidName('')).toBe(false);
    expect(isValidName('x'.repeat(65))).toBe(false);
  });
});
