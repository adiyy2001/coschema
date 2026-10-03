import type { ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';

export function pointerEvent(
  type: string,
  init: { x: number; y: number; id?: number; pointerType?: string; button?: number } & Partial<{
    shiftKey: boolean;
    ctrlKey: boolean;
  }>,
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
  });
  Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return event;
}

export function stubLayout(width: number, height: number): () => void {
  const spy = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(() => new DOMRect(0, 0, width, height));
  return () => {
    spy.mockRestore();
  };
}

export async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}
