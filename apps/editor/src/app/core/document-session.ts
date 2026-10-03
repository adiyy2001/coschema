import { DestroyRef, Injectable, InjectionToken, inject, signal, type Signal } from '@angular/core';
import {
  History,
  META_KEYS,
  getEdges,
  getMeta,
  getNodes,
  initializeDocument,
  type CommandContext,
  type HistoryState,
} from '@coschema/model';
import * as Y from 'yjs';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { GraphView } from './graph-view';
import { RANDOM } from './random';

export type DocumentSeed = (context: CommandContext) => void;
export type DocumentBootstrap = 'immediate' | 'deferred';

export const DOCUMENT_SEED = new InjectionToken<DocumentSeed>('DOCUMENT_SEED', {
  providedIn: 'root',
  factory: () => () => undefined,
});

export const DOCUMENT_BOOTSTRAP = new InjectionToken<DocumentBootstrap>('DOCUMENT_BOOTSTRAP', {
  providedIn: 'root',
  factory: () => 'immediate',
});

@Injectable()
export class DocumentSession {
  readonly doc = new Y.Doc();
  readonly history: History;
  readonly context: CommandContext;
  readonly graph: GraphView;
  private readonly seed = inject(DOCUMENT_SEED);
  private readonly historyStateSignal = signal<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    redoDepth: 0,
  });

  constructor() {
    this.history = new History(this.doc);
    this.context = this.history.context(inject(RANDOM));
    if (inject(DOCUMENT_BOOTSTRAP) === 'immediate') {
      this.prepare();
      this.seed(this.context);
      this.history.clear();
    }
    this.graph = new GraphView(this.doc, inject(FRAME_SCHEDULER));
    this.historyStateSignal.set(this.history.state);
    const unsubscribe = this.history.subscribe((state) => {
      this.historyStateSignal.set(state);
    });
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.graph.destroy();
      this.history.destroy();
      this.doc.destroy();
    });
  }

  get historyState(): Signal<HistoryState> {
    return this.historyStateSignal.asReadonly();
  }

  prepare(): void {
    initializeDocument(this.doc);
  }

  seedIfNeverSeeded(): boolean {
    const meta = getMeta(this.doc);
    const untouched = getNodes(this.doc).size === 0 && getEdges(this.doc).size === 0;
    if (meta.has(META_KEYS.seeded) || !untouched) return false;
    this.doc.transact(() => {
      this.seed(this.context);
      meta.set(META_KEYS.seeded, true);
    }, this.context.origin);
    this.history.clear();
    return true;
  }
}
