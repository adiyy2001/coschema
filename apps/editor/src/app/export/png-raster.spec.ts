import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MAX_PNG_PIXELS, MAX_PNG_SIDE, canvasRasterizer, pngScale } from './png-raster';

const DOCUMENT = { markup: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 300, height: 200 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pngScale', () => {
  it('doubles the size of a small diagram', () => {
    expect(pngScale(400, 300)).toBe(2);
  });

  it('keeps the longest side within the limit', () => {
    const scale = pngScale(20_000, 100);
    expect(scale * 20_000).toBeLessThanOrEqual(MAX_PNG_SIDE);
  });

  it('keeps the number of pixels within the limit', () => {
    const scale = pngScale(8000, 8000);
    expect(8000 * scale * 8000 * scale).toBeLessThanOrEqual(MAX_PNG_PIXELS * 1.0001);
  });
});

interface Drawing {
  readonly width: number;
  readonly height: number;
}

function stubBrowser(options: { context: boolean; blob: boolean }): {
  drawn: Drawing[];
  revoke: MockInstance<(url: string) => void>;
} {
  const drawn: Drawing[] = [];
  const created: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode(): Promise<void> {
        created.push(this.src);
        return Promise.resolve();
      }
    },
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    if (!options.context) return null;
    return {
      drawImage: () => {
        drawn.push({ width: this.width, height: this.height });
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(options.blob ? new Blob(['png'], { type: 'image/png' }) : null);
  });
  return { drawn, revoke };
}

describe('canvasRasterizer', () => {
  it('draws the SVG scaled onto a canvas and returns the PNG blob', async () => {
    const { drawn, revoke } = stubBrowser({ context: true, blob: true });
    const blob = await canvasRasterizer(DOCUMENT, 2);
    expect(blob.type).toBe('image/png');
    expect(drawn).toEqual([{ width: 600, height: 400 }]);
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });

  it('fails clearly without a 2D canvas and still releases the object URL', async () => {
    const { revoke } = stubBrowser({ context: false, blob: true });
    await expect(canvasRasterizer(DOCUMENT, 1)).rejects.toThrow('no 2D canvas');
    expect(revoke).toHaveBeenCalled();
  });

  it('fails when the browser cannot encode the PNG', async () => {
    stubBrowser({ context: true, blob: false });
    await expect(canvasRasterizer(DOCUMENT, 1)).rejects.toThrow('could not encode');
  });
});
