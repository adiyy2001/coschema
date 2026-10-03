export const TAG_FONT_PIXELS = 11;
export const TAG_HEIGHT_PIXELS = 17;
const TAG_CHARACTER_PIXELS = 7.1;
const TAG_PADDING_PIXELS = 12;
const TAG_MAX_NAME_LENGTH = 24;

export function tagWidthPixels(name: string): number {
  return Math.round(
    Math.min(name.length, TAG_MAX_NAME_LENGTH) * TAG_CHARACTER_PIXELS + TAG_PADDING_PIXELS,
  );
}

export function tagLabel(name: string): string {
  return name.length > TAG_MAX_NAME_LENGTH ? `${name.slice(0, TAG_MAX_NAME_LENGTH - 1)}…` : name;
}

const DARK_TEXT = '#000000';
const LIGHT_TEXT = '#ffffff';

function channelLuminance(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  return (
    0.2126 * channelLuminance(hex, 1) +
    0.7152 * channelLuminance(hex, 3) +
    0.0722 * channelLuminance(hex, 5)
  );
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableTextColor(background: string): string {
  return contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT)
    ? DARK_TEXT
    : LIGHT_TEXT;
}
