import { Injectable, InjectionToken, inject } from '@angular/core';
import { Announcements } from '../a11y/announcements';
import { DocumentSession } from '../core/document-session';
import { canvasRasterizer, pngScale, type SvgRasterizer } from './png-raster';
import { buildSvgDocument } from './svg-document';

export interface FileSaver {
  save(blob: Blob, fileName: string): void;
}

function anchorSaver(): FileSaver {
  return {
    save: (blob, fileName) => {
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    },
  };
}

export const FILE_SAVER = new InjectionToken<FileSaver>('FILE_SAVER', {
  providedIn: 'root',
  factory: anchorSaver,
});

export const SVG_RASTERIZER = new InjectionToken<SvgRasterizer>('SVG_RASTERIZER', {
  providedIn: 'root',
  factory: () => canvasRasterizer,
});

export const SVG_FILE_NAME = 'coschema-diagram.svg';
export const PNG_FILE_NAME = 'coschema-diagram.png';

@Injectable()
export class ExportService {
  private readonly session = inject(DocumentSession);
  private readonly saver = inject(FILE_SAVER);
  private readonly rasterizer = inject(SVG_RASTERIZER);
  private readonly announcements = inject(Announcements);

  exportSvg(): boolean {
    const document = buildSvgDocument(this.session.graph.exportScene());
    if (document === undefined) {
      this.announcements.announce('There is nothing to export yet.');
      return false;
    }
    this.saver.save(new Blob([document.markup], { type: 'image/svg+xml' }), SVG_FILE_NAME);
    this.announcements.announce('Exported the diagram as an SVG file.');
    return true;
  }

  async exportPng(): Promise<boolean> {
    const document = buildSvgDocument(this.session.graph.exportScene());
    if (document === undefined) {
      this.announcements.announce('There is nothing to export yet.');
      return false;
    }
    try {
      const blob = await this.rasterizer(document, pngScale(document.width, document.height));
      this.saver.save(blob, PNG_FILE_NAME);
      this.announcements.announce('Exported the diagram as a PNG file.');
      return true;
    } catch {
      this.announcements.announce('The diagram could not be exported as a PNG file.');
      return false;
    }
  }
}
