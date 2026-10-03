import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Announcements } from '../a11y/announcements';
import { COLLAB_CLOCK } from '../collab/collaboration';
import { DocumentSession } from '../core/document-session';
import type { ExportScene } from '../core/graph-view';
import { ManualClock } from '../testing/manual-clock';
import type { SvgRasterizer } from './png-raster';
import {
  ExportService,
  FILE_SAVER,
  PNG_FILE_NAME,
  SVG_FILE_NAME,
  SVG_RASTERIZER,
} from './export-service';

const SCENE: ExportScene = {
  nodes: [
    {
      id: 'a',
      type: 'rect',
      pos: [0, 0],
      size: [120, 64],
      z: 'a0',
      style: {},
      label: 'Pump A',
    },
  ],
  edges: [],
};

function setup(
  scene: ExportScene,
  rasterizer = vi.fn<SvgRasterizer>(() => Promise.resolve(new Blob(['png']))),
) {
  const saved: { blob: Blob; fileName: string }[] = [];
  TestBed.configureTestingModule({
    providers: [
      ExportService,
      Announcements,
      { provide: COLLAB_CLOCK, useValue: new ManualClock() },
      { provide: DocumentSession, useValue: { graph: { exportScene: () => scene } } },
      {
        provide: FILE_SAVER,
        useValue: {
          save: (blob: Blob, fileName: string) => {
            saved.push({ blob, fileName });
          },
        },
      },
      { provide: SVG_RASTERIZER, useValue: rasterizer },
    ],
  });
  return {
    service: TestBed.inject(ExportService),
    announcements: TestBed.inject(Announcements),
    saved,
    rasterizer,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('ExportService', () => {
  it('saves the diagram as an SVG file and announces it', async () => {
    const { service, saved, announcements } = setup(SCENE);
    expect(service.exportSvg()).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.fileName).toBe(SVG_FILE_NAME);
    expect(saved[0]?.blob.type).toBe('image/svg+xml');
    expect(await saved[0]?.blob.text()).toContain('data-node-id="a"');
    expect(announcements.message()).toBe('Exported the diagram as an SVG file.');
  });

  it('rasterizes at the computed scale, saves a PNG and announces it', async () => {
    const { service, saved, rasterizer, announcements } = setup(SCENE);
    expect(await service.exportPng()).toBe(true);
    expect(rasterizer).toHaveBeenCalledTimes(1);
    const [document, scale] = rasterizer.mock.calls[0] ?? [];
    expect(document).toMatchObject({ width: 168, height: 112 });
    expect(scale).toBe(2);
    expect(saved[0]?.fileName).toBe(PNG_FILE_NAME);
    expect(announcements.message()).toBe('Exported the diagram as a PNG file.');
  });

  it('says so and saves nothing when the diagram is empty', async () => {
    const { service, saved, announcements, rasterizer } = setup({ nodes: [], edges: [] });
    expect(service.exportSvg()).toBe(false);
    expect(await service.exportPng()).toBe(false);
    expect(saved).toEqual([]);
    expect(rasterizer).not.toHaveBeenCalled();
    expect(announcements.message().trim()).toBe('There is nothing to export yet.');
  });

  it('reports a PNG failure without saving', async () => {
    const failing = vi.fn<SvgRasterizer>(() => Promise.reject(new Error('no canvas')));
    const { service, saved, announcements } = setup(SCENE, failing);
    expect(await service.exportPng()).toBe(false);
    expect(saved).toEqual([]);
    expect(announcements.message()).toBe('The diagram could not be exported as a PNG file.');
  });
});
