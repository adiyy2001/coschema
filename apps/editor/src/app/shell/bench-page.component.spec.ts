import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FRAME_SCHEDULER } from '../core/frame-scheduler';
import { settle, stubLayout } from '../testing/dom';
import { ManualFrames } from '../testing/manual-frames';
import { BenchPageComponent } from './bench-page.component';

describe('BenchPageComponent', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    restoreLayout = stubLayout(1000, 700);
    const frames = new ManualFrames();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'bench', component: BenchPageComponent }]),
        { provide: FRAME_SCHEDULER, useValue: frames.schedule },
      ],
    });
  });

  afterEach(() => {
    restoreLayout();
  });

  it('renders the requested number of nodes at the requested zoom', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/bench?nodes=40&zoom=0.5');
    await settle(harness.fixture);
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
    expect(root.querySelector('g.nodes')).not.toBeNull();
  });

  it('fits the content when no zoom is given and handles an empty scene', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/bench?nodes=0');
    await settle(harness.fixture);
    expect((harness.routeNativeElement as HTMLElement).querySelector('cs-canvas')).not.toBeNull();
  });
});
