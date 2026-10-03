import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { LINK_PROFILES } from '@coschema/sim/link';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLAB_CLOCK } from '../collab/collaboration';
import { mulberry32 } from '../core/bench-scene';
import { FRAME_SCHEDULER } from '../core/frame-scheduler';
import { RANDOM } from '../core/random';
import { settle, stubLayout } from '../testing/dom';
import { ManualClock } from '../testing/manual-clock';
import { ManualFrames } from '../testing/manual-frames';
import { DemoPageComponent } from './demo-page.component';
import { DEMO_OPTIONS, MESS_OFFLINE_MS } from './demo-world';

interface Mounted {
  readonly fixture: ComponentFixture<DemoPageComponent>;
  readonly root: HTMLElement;
  readonly clock: ManualClock;
  readonly frames: ManualFrames;
  readonly restore: () => void;
  advance(durationMs: number): Promise<void>;
}

async function mount(paneCount = 2): Promise<Mounted> {
  const restore = stubLayout(900, 520);
  const clock = new ManualClock();
  const frames = new ManualFrames();
  TestBed.configureTestingModule({
    providers: [
      { provide: COLLAB_CLOCK, useValue: clock },
      { provide: FRAME_SCHEDULER, useValue: frames.schedule },
      { provide: RANDOM, useValue: mulberry32(5) },
      { provide: DEMO_OPTIONS, useValue: { paneCount, search: '' } },
    ],
  });
  const fixture = TestBed.createComponent(DemoPageComponent);
  document.body.append(fixture.nativeElement as HTMLElement);
  const advance = async (durationMs: number): Promise<void> => {
    for (let step = 0; step < durationMs; step += 50) {
      clock.advance(50);
      await Promise.resolve();
    }
    frames.tick();
    await settle(fixture);
  };
  await settle(fixture);
  await advance(1000);
  return { fixture, root: fixture.nativeElement as HTMLElement, clock, frames, restore, advance };
}

function element<T extends Element>(root: ParentNode, selector: string, type: new () => T): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`missing ${selector}`);
  return found;
}

function panes(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-pane]')];
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

let current: Mounted | undefined;

afterEach(() => {
  current?.restore();
  current = undefined;
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('DemoPageComponent', () => {
  it('shows two named editors that start online with the starter diagram', async () => {
    current = await mount();
    const names = panes(current.root).map((pane) => pane.getAttribute('data-pane'));
    expect(names).toEqual(['Ada', 'Bruno']);
    for (const pane of panes(current.root)) {
      expect(pane.querySelector('[data-link-state]')?.textContent.trim()).toBe('Online');
      expect(pane.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
    }
    expect(current.root.querySelector('h1')?.textContent).toContain('Live collaboration demo');
    expect(current.root.textContent).toContain('nothing leaves your browser');
  });

  it('shows three editors when the page asks for three', async () => {
    current = await mount(3);
    expect(panes(current.root)).toHaveLength(3);
  });

  it('applies a network profile to every pane and marks the choice as pressed', async () => {
    current = await mount();
    const slow = element(current.root, '[data-profile="slow"]', HTMLButtonElement);
    slow.click();
    await settle(current.fixture);
    expect(slow.getAttribute('aria-pressed')).toBe('true');
    expect(
      element(current.root, '[data-profile="clean"]', HTMLButtonElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
    for (const pane of panes(current.root)) {
      const latency = element(pane, '[data-latency-value]', HTMLElement).textContent.trim();
      expect(latency).not.toBe(`${LINK_PROFILES.clean.latencyMs} ms`);
    }
  });

  it('moves the sliders of one pane and shows the new values', async () => {
    current = await mount();
    const [first, second] = panes(current.root);
    if (first === undefined || second === undefined) throw new Error('missing panes');
    typeInto(element(first, '[data-latency]', HTMLInputElement), '300');
    typeInto(element(first, '[data-jitter]', HTMLInputElement), '120');
    typeInto(element(first, '[data-loss]', HTMLInputElement), '20');
    await settle(current.fixture);
    expect(element(first, '[data-latency-value]', HTMLElement).textContent.trim()).toBe('300 ms');
    expect(element(first, '[data-jitter-value]', HTMLElement).textContent.trim()).toBe('120 ms');
    expect(element(first, '[data-loss-value]', HTMLElement).textContent.trim()).toBe('20%');
    expect(element(second, '[data-latency-value]', HTMLElement).textContent.trim()).toBe(
      `${LINK_PROFILES.clean.latencyMs} ms`,
    );
  });

  it('takes one editor offline and back online with the switch', async () => {
    current = await mount();
    const [first, second] = panes(current.root);
    if (first === undefined || second === undefined) throw new Error('missing panes');
    const toggle = element(first, '[data-link-offline]', HTMLInputElement);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(current.fixture);
    expect(element(first, '[data-link-state]', HTMLElement).textContent.trim()).toBe('Offline');
    expect(element(second, '[data-link-state]', HTMLElement).textContent.trim()).toBe('Online');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(current.fixture);
    expect(element(first, '[data-link-state]', HTMLElement).textContent.trim()).toBe('Online');
  });

  it('disables the mess button while the mess runs and enables it afterwards', async () => {
    current = await mount();
    const mess = element(current.root, '[data-action="make-mess"]', HTMLButtonElement);
    mess.click();
    await settle(current.fixture);
    expect(mess.disabled).toBe(true);
    expect(mess.textContent.trim()).toBe('Making a mess');
    for (const pane of panes(current.root)) {
      expect(element(pane, '[data-link-state]', HTMLElement).textContent.trim()).toBe('Offline');
    }
    await current.advance(MESS_OFFLINE_MS + 100);
    expect(mess.disabled).toBe(false);
    expect(mess.textContent.trim()).toBe('Make a mess');
    for (const pane of panes(current.root)) {
      expect(element(pane, '[data-link-state]', HTMLElement).textContent.trim()).toBe('Online');
    }
  });

  it('resets to a fresh room with the clean profile', async () => {
    current = await mount();
    element(current.root, '[data-profile="chaotic"]', HTMLButtonElement).click();
    await settle(current.fixture);
    element(current.root, '[data-action="reset"]', HTMLButtonElement).click();
    await current.advance(1000);
    expect(
      element(current.root, '[data-profile="clean"]', HTMLButtonElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    expect(panes(current.root)).toHaveLength(2);
    for (const pane of panes(current.root)) {
      expect(element(pane, '[data-latency-value]', HTMLElement).textContent.trim()).toBe(
        `${LINK_PROFILES.clean.latencyMs} ms`,
      );
    }
  });
});
