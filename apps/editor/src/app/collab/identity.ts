import { PRESENCE_COLORS, type PresenceUser, type RandomSource } from '@coschema/model';

export interface Identity extends PresenceUser {
  readonly id: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const IDENTITY_KEY = 'coschema:identity';
export const MAX_DISPLAY_NAME_LENGTH = 40;

const GIVEN_NAMES: readonly string[] = [
  'Anna',
  'Bartek',
  'Celina',
  'Dawid',
  'Ewa',
  'Franek',
  'Gosia',
  'Hubert',
  'Iga',
  'Jan',
  'Kasia',
  'Leon',
];

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;

function pick<Item>(items: readonly Item[], random: RandomSource, fallback: Item): Item {
  return items[Math.floor(random() * items.length)] ?? fallback;
}

function randomId(random: RandomSource): string {
  let id = '';
  for (let index = 0; index < 12; index += 1) id += Math.floor(random() * 36).toString(36);
  return id;
}

export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function createIdentity(random: RandomSource): Identity {
  const given = pick(GIVEN_NAMES, random, 'Guest');
  const suffix = Math.floor(random() * 90) + 10;
  return {
    id: randomId(random),
    name: `${given} ${suffix}`,
    color: pick(PRESENCE_COLORS, random, '#1c7ed6'),
  };
}

export function parseIdentity(raw: string | null): Identity | undefined {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const { id, name, color } = value as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string') return undefined;
    if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) return undefined;
    const cleaned = sanitizeName(name);
    return cleaned === '' ? undefined : { id, name: cleaned, color: color.toLowerCase() };
  } catch {
    return undefined;
  }
}

function readStored(storage: KeyValueStorage | undefined): string | null {
  try {
    return storage?.getItem(IDENTITY_KEY) ?? null;
  } catch {
    return null;
  }
}

export function loadIdentity(storage: KeyValueStorage | undefined, random: RandomSource): Identity {
  const existing = parseIdentity(readStored(storage));
  if (existing !== undefined) return existing;
  const created = createIdentity(random);
  saveIdentity(storage, created);
  return created;
}

export function saveIdentity(storage: KeyValueStorage | undefined, identity: Identity): void {
  try {
    storage?.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    return;
  }
}

export function renameIdentity(identity: Identity, rawName: string): Identity {
  const name = sanitizeName(rawName);
  return name === '' ? identity : { ...identity, name };
}
