import type { SvgDocument } from './svg-document';

export const PREFERRED_PNG_SCALE = 2;
export const MAX_PNG_SIDE = 8192;
export const MAX_PNG_PIXELS = 48_000_000;

export type SvgRasterizer = (document: SvgDocument, scale: number) => Promise<Blob>;

export function pngScale(width: number, height: number): number {
  const bySide = MAX_PNG_SIDE / Math.max(width, height);
  const byArea = Math.sqrt(MAX_PNG_PIXELS / (width * height));
  return Math.min(PREFERRED_PNG_SCALE, bySide, byArea);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('the browser could not encode the PNG'));
      else resolve(blob);
    }, 'image/png');
  });
}

export const canvasRasterizer: SvgRasterizer = async (document, scale) => {
  const source = new Blob([document.markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(document.width * scale));
    canvas.height = Math.max(1, Math.round(document.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('the browser has no 2D canvas');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
};
