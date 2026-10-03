import { Injectable } from '@angular/core';

let nextSerial = 0;

@Injectable()
export class CanvasIds {
  private readonly serial: number;
  readonly arrow: string;
  readonly grid: string;
  readonly hint: string;

  constructor() {
    nextSerial += 1;
    this.serial = nextSerial;
    this.arrow = `cs-arrow-${this.serial}`;
    this.grid = `cs-grid-${this.serial}`;
    this.hint = `cs-canvas-hint-${this.serial}`;
  }

  get arrowReference(): string {
    return `url(#${this.arrow})`;
  }

  get gridReference(): string {
    return `url(#${this.grid})`;
  }
}
