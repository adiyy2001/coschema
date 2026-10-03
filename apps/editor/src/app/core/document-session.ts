import { DestroyRef, Injectable, InjectionToken, inject, signal, type Signal } from '@angular/core';
import {
  History,
  initializeDocument,
  type CommandContext,
  type HistoryState,
} from '@coschema/model';
import * as Y from 'yjs';
import { FRAME_SCHEDULER } from './frame-scheduler';
import { GraphView } from './graph-view';
import { RANDOM } from './random';

export type DocumentSeed = (context: CommandContext) => void;

export const DOCUMENT_SEED = new InjectionToken<DocumentSeed>('DOCUMENT_SEED', {
  providedIn: 'root',
  factory: () => () => undefined,
});

@Injectable()
export class DocumentSession {
  readonly doc = new Y.Doc();
  readonly history: History;
  readonly context: CommandContext;
  readonly graph: GraphView;
  private readonly historyStateSignal = signal<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    redoDepth: 0,
  });

  constructor() {
    initializeDocument(this.doc);
    this.history = new History(this.doc);
    this.context = this.history.context(inject(RANDOM));
    inject(DOCUMENT_SEED)(this.context);
    this.history.clear();
    this.historyStateSignal.set(this.history.state);
    this.graph = new GraphView(this.doc, inject(FRAME_SCHEDULER));
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
}
