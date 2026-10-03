import { deleteNodes, replaceLabelRange } from '@coschema/model';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ViewportState } from '../canvas/viewport-state';
import { FRAME_SCHEDULER } from '../core/frame-scheduler';
import { DocumentSession } from '../core/document-session';
import { RANDOM } from '../core/random';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';
import { pointerEvent, settle, stubLayout } from '../testing/dom';
import { ManualFrames } from '../testing/manual-frames';
import { mulberry32 } from '../core/bench-scene';
import { EditorPageComponent } from './editor-page.component';

interface Page {
  readonly fixture: ComponentFixture<EditorPageComponent>;
  readonly root: HTMLElement;
  readonly surface: SVGSVGElement;
  readonly frames: ManualFrames;
  readonly session: DocumentSession;
  readonly selection: SelectionState;
  readonly controller: InteractionController;
  readonly viewport: ViewportState;
}

async function mount(): Promise<Page> {
  const frames = new ManualFrames();
  TestBed.configureTestingModule({
    providers: [
      { provide: FRAME_SCHEDULER, useValue: frames.schedule },
      { provide: RANDOM, useValue: mulberry32(11) },
    ],
  });
  const fixture = TestBed.createComponent(EditorPageComponent);
  document.body.append(fixture.nativeElement as HTMLElement);
  await settle(fixture);
  const injector = fixture.debugElement.injector;
  const root = fixture.nativeElement as HTMLElement;
  const surface = root.querySelector('svg.surface');
  if (!(surface instanceof SVGSVGElement)) throw new Error('surface missing');
  return {
    fixture,
    root,
    surface,
    frames,
    session: injector.get(DocumentSession),
    selection: injector.get(SelectionState),
    controller: injector.get(InteractionController),
    viewport: injector.get(ViewportState),
  };
}

async function press(
  page: Page,
  x: number,
  y: number,
  init: { shiftKey?: boolean; ctrlKey?: boolean } = {},
): Promise<void> {
  page.surface.dispatchEvent(pointerEvent('pointerdown', { x, y, ...init }));
  await settle(page.fixture);
}

async function move(page: Page, x: number, y: number): Promise<void> {
  page.surface.dispatchEvent(pointerEvent('pointermove', { x, y }));
  page.frames.tick();
  await settle(page.fixture);
}

async function release(page: Page, x: number, y: number): Promise<void> {
  page.surface.dispatchEvent(pointerEvent('pointerup', { x, y }));
  page.frames.tick();
  await settle(page.fixture);
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await press(page, from[0], from[1]);
  await move(page, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  await move(page, to[0], to[1]);
  await release(page, to[0], to[1]);
}

async function key(page: Page, init: KeyboardEventInit): Promise<void> {
  page.surface.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
  page.surface.dispatchEvent(
    new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }),
  );
  page.frames.tick();
  await settle(page.fixture);
}

function nodeElement(page: Page, id: string): Element | null {
  return page.root.querySelector(`[data-node-id="${id}"]`);
}

function positionOf(page: Page, id: string): readonly [number, number] | undefined {
  return page.session.graph.committedNode(id)?.pos;
}

describe('EditorPageComponent', () => {
  let restoreLayout: () => void;
  let page: Page;

  beforeEach(async () => {
    restoreLayout = stubLayout(1200, 800);
    page = await mount();
  });

  afterEach(() => {
    page.fixture.destroy();
    restoreLayout();
  });

  it('renders the starter diagram with labels, edges and the toolbar', () => {
    expect(page.root.querySelectorAll('[data-node-id]')).toHaveLength(7);
    expect(page.root.querySelectorAll('[data-edge-id]')).toHaveLength(7);
    expect(page.root.textContent).toContain('Pump A');
    expect(page.root.textContent).toContain('7 nodes, 7 edges');
    expect(page.root.querySelectorAll('[data-edge-id] path.line')).toHaveLength(7);
  });

  it('selects a node on click and clears the selection on empty canvas', async () => {
    await press(page, 110, 190);
    await release(page, 110, 190);
    expect(page.selection.selection().nodes).toEqual(['intake']);
    expect(nodeElement(page, 'intake')?.classList.contains('selected')).toBe(true);
    await press(page, 700, 700);
    await release(page, 700, 700);
    expect(page.selection.isEmpty()).toBe(true);
  });

  it('drags a node, snaps it, commits one undo step and shows ports for the selection', async () => {
    await drag(page, [110, 190], [210, 290]);
    expect(positionOf(page, 'intake')).toEqual([184, 272]);
    expect(page.session.history.state.undoDepth).toBe(1);
    expect(page.root.querySelectorAll('circle.port').length).toBeGreaterThan(0);
  });

  it('previews the drag without writing to the document until release', async () => {
    await press(page, 110, 190);
    await move(page, 150, 230);
    await move(page, 190, 270);
    expect(positionOf(page, 'intake')).toEqual([80, 168]);
    expect(page.session.graph.peekNode('intake')?.pos).not.toEqual([80, 168]);
    await release(page, 190, 270);
    expect(positionOf(page, 'intake')).not.toEqual([80, 168]);
  });

  it('selects several nodes with shift and with a marquee', async () => {
    await press(page, 110, 190);
    await release(page, 110, 190);
    await press(page, 360, 100, { shiftKey: true });
    await release(page, 360, 100);
    expect(page.selection.selection().nodes.toSorted()).toEqual(['intake', 'pump-a']);
    await press(page, 20, 20);
    await move(page, 300, 200);
    expect(page.root.querySelector('rect.marquee')).not.toBeNull();
    await move(page, 520, 420);
    await release(page, 520, 420);
    expect(page.selection.selection().nodes.length).toBeGreaterThanOrEqual(3);
    expect(page.root.querySelector('rect.marquee')).toBeNull();
  });

  it('connects two nodes by dragging from a port', async () => {
    const before = page.session.graph.edgeCount();
    await press(page, 110, 190);
    await release(page, 110, 190);
    await drag(page, [200, 200], [380, 300]);
    page.frames.tick();
    await settle(page.fixture);
    expect(page.session.graph.edgeCount()).toBe(before + 1);
    expect(page.selection.selection().edges).toHaveLength(1);
  });

  it('shows a connection preview while dragging from a port', async () => {
    await press(page, 110, 190);
    await release(page, 110, 190);
    await press(page, 200, 200);
    await move(page, 260, 260);
    await move(page, 300, 300);
    expect(page.root.querySelector('path.connect')).not.toBeNull();
    await release(page, 900, 700);
    expect(page.root.querySelector('path.connect')).toBeNull();
  });

  it('pans with the hand tool and with space plus drag', async () => {
    page.controller.setTool('hand');
    await settle(page.fixture);
    await drag(page, [600, 600], [650, 640]);
    expect(page.viewport.viewport().x).toBe(50);
    expect(page.viewport.viewport().y).toBe(40);
    page.controller.setTool('select');
    await key(page, { key: ' ' });
    page.surface.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await drag(page, [600, 600], [620, 610]);
    expect(page.viewport.viewport().x).toBeGreaterThan(50);
  });

  it('zooms around the pointer on ctrl wheel and pans on a plain wheel', async () => {
    page.surface.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
        ctrlKey: true,
        clientX: 300,
        clientY: 300,
      }),
    );
    await settle(page.fixture);
    expect(page.viewport.zoom()).toBeGreaterThan(1);
    const x = page.viewport.viewport().x;
    page.surface.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40, deltaX: 30 }),
    );
    await settle(page.fixture);
    expect(page.viewport.viewport().x).toBeLessThan(x);
  });

  it('switches level of detail with zoom', async () => {
    page.viewport.viewport.update((current) => ({ ...current, zoom: 0.3 }));
    await settle(page.fixture);
    expect(page.root.querySelector('.label')).toBeNull();
    expect(page.root.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
    page.viewport.viewport.update((current) => ({ ...current, zoom: 0.1 }));
    await settle(page.fixture);
    expect(page.root.querySelector('g[cs-overview]')).not.toBeNull();
    expect(page.root.querySelector('[data-node-id]')).toBeNull();
    expect(page.root.querySelector('path.overview-nodes')?.getAttribute('d')).toMatch(/^M/);
    expect(page.root.querySelector('pattern circle')).not.toBeNull();
  });

  it('creates a node with a shape tool and returns to select', async () => {
    const before = page.session.graph.nodeCount();
    page.root.querySelector<HTMLButtonElement>('[data-tool="ellipse"]')?.click();
    await settle(page.fixture);
    await press(page, 600, 600);
    await release(page, 600, 600);
    expect(page.session.graph.nodeCount()).toBe(before + 1);
    expect(page.controller.tool()).toBe('select');
    expect(page.selection.selection().nodes).toHaveLength(1);
  });

  it('deletes the selection with the keyboard and undoes and redoes it', async () => {
    await press(page, 110, 190);
    await release(page, 110, 190);
    await key(page, { key: 'Delete' });
    expect(page.session.graph.nodeCount()).toBe(6);
    expect(page.session.graph.edgeCount()).toBe(5);
    await key(page, { key: 'z', ctrlKey: true });
    expect(page.session.graph.nodeCount()).toBe(7);
    expect(page.session.graph.edgeCount()).toBe(7);
    await key(page, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(page.session.graph.nodeCount()).toBe(6);
    await key(page, { key: 'z', ctrlKey: true });
    await key(page, { key: 'y', ctrlKey: true });
    expect(page.session.graph.nodeCount()).toBe(6);
  });

  it('selects an edge by clicking it and deletes it from the toolbar', async () => {
    await press(page, 316, 150);
    await release(page, 316, 150);
    expect(page.selection.selection().edges).toHaveLength(1);
    page.root.querySelector<HTMLButtonElement>('[data-action="delete"]')?.click();
    page.frames.tick();
    await settle(page.fixture);
    expect(page.session.graph.edgeCount()).toBe(6);
  });

  it('updates the toolbar buttons from the history and the view state', async () => {
    const undo = page.root.querySelector<HTMLButtonElement>('[data-action="undo"]');
    const redo = page.root.querySelector<HTMLButtonElement>('[data-action="redo"]');
    expect(undo?.disabled).toBe(true);
    await drag(page, [110, 190], [210, 290]);
    expect(undo?.disabled).toBe(false);
    undo?.click();
    await settle(page.fixture);
    expect(redo?.disabled).toBe(false);
    expect(positionOf(page, 'intake')).toEqual([80, 168]);
    redo?.click();
    await settle(page.fixture);
    expect(positionOf(page, 'intake')).toEqual([184, 272]);
    page.root.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.click();
    await settle(page.fixture);
    expect(page.root.querySelector('.zoom')?.textContent.trim()).toBe('125%');
    page.root.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')?.click();
    page.root.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')?.click();
    await settle(page.fixture);
    page.root.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]')?.click();
    await settle(page.fixture);
    expect(page.viewport.zoom()).toBe(1);
    page.viewport.viewport.set({ x: 500, y: 500, zoom: 1 });
    page.root.querySelector<HTMLButtonElement>('[data-action="fit"]')?.click();
    await settle(page.fixture);
    expect(page.viewport.viewport().x).not.toBe(500);
    page.root.querySelector<HTMLButtonElement>('[data-action="snap"]')?.click();
    await settle(page.fixture);
    expect(page.controller.snap().enabled).toBe(false);
  });

  it('edits a label inline with one undo step and closes on Enter', async () => {
    page.surface.dispatchEvent(pointerEvent('dblclick', { x: 360, y: 100 }));
    await settle(page.fixture);
    await settle(page.fixture);
    const input = page.root.querySelector<HTMLInputElement>('cs-label-editor input');
    expect(input?.hidden).toBe(false);
    expect(input?.value).toBe('Pump A');
    if (input === null) throw new Error('input missing');
    input.value = 'Main pump';
    input.setSelectionRange(9, 9);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(page.fixture);
    expect(page.session.graph.committedNode('pump-a')?.label).toBe('Main pump');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settle(page.fixture);
    expect(page.controller.editingNode()).toBeUndefined();
    expect(input.hidden).toBe(true);
    expect(page.session.history.state.undoDepth).toBe(1);
    page.controller.undo();
    page.frames.tick();
    await settle(page.fixture);
    expect(page.session.graph.committedNode('pump-a')?.label).toBe('Pump A');
  });

  it('opens the label editor from the keyboard and closes it on blur', async () => {
    await press(page, 360, 100);
    await release(page, 360, 100);
    await key(page, { key: 'Enter' });
    await settle(page.fixture);
    expect(page.controller.editingNode()).toBe('pump-a');
    page.root.querySelector('cs-label-editor input')?.dispatchEvent(new Event('blur'));
    await settle(page.fixture);
    expect(page.controller.editingNode()).toBeUndefined();
  });

  it('keeps the caret in place when a remote edit changes the label', async () => {
    page.controller.startLabelEdit('pump-a');
    await settle(page.fixture);
    await settle(page.fixture);
    const input = page.root.querySelector<HTMLInputElement>('cs-label-editor input');
    if (input === null) throw new Error('input missing');
    input.setSelectionRange(5, 6);
    input.dispatchEvent(new Event('select'));
    page.session.doc.transact(() => {
      replaceLabelRange({ ...page.session.context, origin: 'remote' }, 'pump-a', 0, 0, 'Big ');
    }, 'remote');
    await settle(page.fixture);
    expect(input.value).toBe('Big Pump A');
    expect(input.selectionStart).toBe(9);
  });

  it('closes the editor when the node disappears', async () => {
    page.controller.startLabelEdit('pump-a');
    await settle(page.fixture);
    page.selection.set({ nodes: ['pump-a'], edges: [] });
    await key(page, { key: 'Escape' });
    expect(page.selection.isEmpty()).toBe(true);
    page.controller.startLabelEdit('pump-b');
    await settle(page.fixture);
    deleteNodes(page.session.context, ['pump-b']);
    page.frames.tick();
    await settle(page.fixture);
    expect(page.controller.editingNode()).toBeUndefined();
  });

  it('ignores label editing for an unknown node', () => {
    page.controller.startLabelEdit('missing');
    expect(page.controller.editingNode()).toBeUndefined();
    page.controller.editSelectedLabel();
    expect(page.controller.editingNode()).toBeUndefined();
  });

  it('highlights hover state and clears it on leave', async () => {
    page.surface.dispatchEvent(pointerEvent('pointermove', { x: 110, y: 190 }));
    await settle(page.fixture);
    expect(page.controller.hoverHit()).toBe('node');
    expect(page.controller.hoverNode()).toBe('intake');
    expect(page.root.querySelector('cs-canvas')?.classList.contains('move')).toBe(true);
    page.surface.dispatchEvent(pointerEvent('pointermove', { x: 200, y: 200 }));
    await settle(page.fixture);
    expect(page.controller.hoverHit()).toBe('port');
    page.surface.dispatchEvent(new Event('pointerleave'));
    await settle(page.fixture);
    expect(page.controller.hoverNode()).toBeUndefined();
  });

  it('finds the nearest port of a node', () => {
    expect(page.controller.nearestPort('intake', [210, 200])).toBe('e');
    expect(page.controller.nearestPort('missing', [0, 0])).toBeUndefined();
  });

  it('cancels a drag with pointercancel', async () => {
    await press(page, 110, 190);
    await move(page, 150, 230);
    await move(page, 190, 270);
    page.surface.dispatchEvent(pointerEvent('pointercancel', { x: 190, y: 270 }));
    page.frames.tick();
    await settle(page.fixture);
    expect(positionOf(page, 'intake')).toEqual([80, 168]);
    expect(page.session.graph.peekNode('intake')?.pos).toEqual([80, 168]);
  });
});
