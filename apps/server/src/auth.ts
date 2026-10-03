import type { AuthResult } from '@coschema/sync';
import { SignJWT, jwtVerify } from 'jose';

const TOKEN_ISSUER = 'coschema';
const TOKEN_AUDIENCE = 'coschema';
const TOKEN_ALGORITHM = 'HS256';
const CLOCK_TOLERANCE_SECONDS = 5;
export const DEFAULT_TOKEN_TTL_SECONDS = 3600;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const MAX_NAME_LENGTH = 64;

export interface TokenIdentity {
  readonly sub: string;
  readonly name: string;
  readonly color: string;
  readonly room: string;
}

export interface TokenVerifierOptions {
  readonly secret: string;
  readonly now: () => Date;
}

export type TokenVerifier = (token: string, room: string) => Promise<AuthResult>;

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function isValidColor(color: string): boolean {
  return COLOR_PATTERN.test(color);
}

export function isValidName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MAX_NAME_LENGTH;
}

export interface SignOptions {
  readonly secret: string;
  readonly now: () => Date;
  readonly ttlSeconds?: number;
  readonly issuer?: string;
  readonly audience?: string;
}

export async function signToken(identity: TokenIdentity, options: SignOptions): Promise<string> {
  const issuedAt = Math.floor(options.now().getTime() / 1000);
  return new SignJWT({ name: identity.name, color: identity.color, room: identity.room })
    .setProtectedHeader({ alg: TOKEN_ALGORITHM })
    .setSubject(identity.sub)
    .setIssuer(options.issuer ?? TOKEN_ISSUER)
    .setAudience(options.audience ?? TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (options.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS))
    .sign(encodeSecret(options.secret));
}

function readIdentity(payload: Record<string, unknown>): TokenIdentity | undefined {
  const { sub, name, color, room } = payload;
  if (typeof sub !== 'string' || sub === '') return undefined;
  if (typeof name !== 'string' || !isValidName(name)) return undefined;
  if (typeof color !== 'string' || !isValidColor(color)) return undefined;
  if (typeof room !== 'string' || room === '') return undefined;
  return { sub, name, color, room };
}

export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  const key = encodeSecret(options.secret);
  return async (token, room) => {
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [TOKEN_ALGORITHM],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: options.now(),
        requiredClaims: ['sub', 'exp', 'name', 'color', 'room'],
      });
      const identity = readIdentity(payload);
      if (identity === undefined) return { ok: false, reason: 'invalid token claims' };
      if (identity.room !== room) return { ok: false, reason: 'token is for another room' };
      return { ok: true, identity };
    } catch {
      return { ok: false, reason: 'invalid token' };
    }
  };
}
