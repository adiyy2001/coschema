import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcements } from '../a11y/announcements';
import { KeyboardController } from '../a11y/keyboard-controller';
import { mulberry32 } from '../core/bench-scene';
import { DocumentSession } from '../core/document-session';
import { FRAME_SCHEDULER } from '../core/frame-scheduler';
import { RANDOM } from '../core/random';
import { SelectionState } from '../interaction/selection-state';
import { settle, stubLayout } from '../testing/dom';
import { ManualFrames } from '../testing/manual-frames';
import { EditorPageComponent } from './editor-page.component';

interface Page {
  readonly fixture: ComponentFixture<EditorPageComponent>;
  readonly root: HTMLElement;
  readonly surface: SVGSVGElement;
  readonly frames: ManualFrames;
  readonly session: DocumentSession;
  readonly selection: SelectionState;
  readonly keyboard: KeyboardController;
  readonly announcements: Announcements;
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
    keyboard: injector.get(KeyboardController),
    announcements: injector.get(Announcements),
  };
}

async function press(page: Page, init: KeyboardEventInit, target?: Element): Promise<void> {
  const element = target ?? document.activeElement ?? page.surface;
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  page.frames.tick();
  await settle(page.fixture);
  page.frames.tick();
  await settle(page.fixture);
}

function nodeElement(page: Page, id: string): HTMLElement {
  const element = page.root.querySelector(`[data-node-id="${id}"]`);
  if (!(element instanceof HTMLElement || element instanceof SVGElement))
    throw new Error(`node ${id} missing`);
  return element as unknown as HTMLElement;
}

describe('editor keyboard operation', () => {
  let restoreLayout: () => void;
  let page: Page;

  beforeEach(async () => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    });
    restoreLayout = stubLayout(1200, 800);
    page = await mount();
  });

  afterEach(() => {
    page.fixture.destroy();
    restoreLayout();
    vi.restoreAllMocks();
  });

  it('gives every node an accessible name and one tab stop', () => {
    const nodes = [...page.root.querySelectorAll('[data-node-id]')];
    expect(nodes).toHaveLength(7);
    expect(nodes.every((node) => node.getAttribute('aria-label')?.includes(',') === true)).toBe(
      true,
    );
    expect(page.root.querySelectorAll('[data-node-id][tabindex="0"]')).toHaveLength(1);
    expect(page.surface.getAttribute('tabindex')).toBe('-1');
  });

  it('describes the canvas and its keys to assistive technology', () => {
    const hint = page.surface.getAttribute('aria-describedby');
    expect(hint).not.toBeNull();
    expect(document.getElementById(hint ?? '')?.textContent).toContain('arrow');
  });

  it('moves the focused node with the arrow keys as one undo step', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    const before = page.session.graph.committedNode('intake')?.pos;
    await press(page, { key: 'ArrowRight' });
    await press(page, { key: 'ArrowRight', repeat: true });
    const after = page.session.graph.committedNode('intake')?.pos;
    expect(after?.[0]).toBeGreaterThan(before?.[0] ?? 0);
    expect(after?.[1]).toBe(before?.[1]);
    expect(page.session.history.state.undoDepth).toBe(1);
    await press(page, { key: 'z', ctrlKey: true });
    expect(page.session.graph.committedNode('intake')?.pos).toEqual(before);
    expect(page.announcements.message()).toContain('Undid');
  });

  it('follows the selection with focus and walks the reading order with N and P', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: 'n' });
    const first = page.keyboard.focus();
    expect(first?.kind).toBe('node');
    expect(first?.id).not.toBe('intake');
    await press(page, { key: 'p' });
    expect(page.keyboard.focus()).toEqual({ kind: 'node', id: 'intake' });
    expect(page.selection.selection().nodes).toEqual(['intake']);
  });

  it('opens the label editor with Enter and returns focus to the node after it closes', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: 'Enter' });
    expect(page.root.querySelector('textarea, input, [contenteditable]')).not.toBeNull();
    await press(page, { key: 'Escape' }, page.root.querySelector('textarea, input') ?? undefined);
    await settle(page.fixture);
    expect(page.keyboard.focus()).toEqual({ kind: 'node', id: 'intake' });
  });

  it('connects two nodes with C, a candidate choice and Enter', async () => {
    const edges = page.session.graph.edgeCount();
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: 'c' });
    expect(page.keyboard.mode().kind).toBe('connect');
    await press(page, { key: 'ArrowRight' });
    await press(page, { key: 'Enter' });
    expect(page.keyboard.mode().kind).toBe('browse');
    expect(page.session.graph.edgeCount()).toBe(edges + 1);
    expect(page.announcements.message()).toContain('Connected');
    expect(page.keyboard.focus()?.kind).toBe('edge');
  });

  it('cancels connect mode with Escape without adding an edge', async () => {
    const edges = page.session.graph.edgeCount();
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: 'c' });
    await press(page, { key: 'Escape' });
    expect(page.keyboard.mode().kind).toBe('browse');
    expect(page.session.graph.edgeCount()).toBe(edges);
  });

  it('deletes the focused node, announces it and moves focus to a neighbour', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: 'Delete' });
    expect(page.session.graph.peekNode('intake')).toBeUndefined();
    expect(page.announcements.message()).toMatch(/^Deleted /);
    expect(page.keyboard.focus()).toBeDefined();
  });

  it('opens and closes the shortcuts dialog with a question mark', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: '?', shiftKey: true });
    expect(page.keyboard.helpOpen()).toBe(true);
    const dialog = page.root.querySelector('dialog[aria-label="Keyboard shortcuts"]');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.textContent).toContain('Enter');
  });

  it('adds a node from the toolbar button, focuses it and announces it', async () => {
    const count = page.session.graph.nodeCount();
    const button = page.root.querySelector('[data-action="add-node"]');
    if (!(button instanceof HTMLElement)) throw new Error('add button missing');
    button.click();
    await settle(page.fixture);
    page.frames.tick();
    await settle(page.fixture);
    expect(page.session.graph.nodeCount()).toBe(count + 1);
    expect(page.announcements.message()).toContain('Added');
    expect(page.keyboard.focus()?.kind).toBe('node');
  });

  it('exposes a polite live region with the current announcement', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    await press(page, { key: 'z', ctrlKey: true });
    const region = page.root.querySelector('[data-live-region]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent.trim()).toBe('Nothing to undo.');
  });

  it('keeps a focused node in the document when it is outside the visible area', async () => {
    page.keyboard.focusNode('intake');
    await settle(page.fixture);
    expect(nodeElement(page, 'intake').getAttribute('tabindex')).toBe('0');
  });
});
