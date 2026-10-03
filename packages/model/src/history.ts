import * as Y from 'yjs';
import type { RandomSource } from './base62';
import type { CommandContext } from './commands/context';
import { getEdges, getNodes } from './schema';

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
}

export type HistoryListener = (state: HistoryState) => void;

export interface Gesture {
  end(): void;
}

export interface HistoryOptions {
  readonly origin?: object;
}

const NEVER_MERGE_BY_TIME = Number.MAX_SAFE_INTEGER;

export class History {
  readonly origin: object;
  private readonly undoManager: Y.UndoManager;
  private readonly listeners = new Set<HistoryListener>();
  private openGestures = 0;

  constructor(
    readonly doc: Y.Doc,
    options: HistoryOptions = {},
  ) {
    this.origin = options.origin ?? { kind: 'local-edit' };
    this.undoManager = new Y.UndoManager([getNodes(doc), getEdges(doc)], {
      trackedOrigins: new Set<unknown>([this.origin]),
      captureTimeout: NEVER_MERGE_BY_TIME,
      ignoreRemoteMapChanges: false,
    });
    doc.on('beforeTransaction', this.onBeforeTransaction);
    for (const event of ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const) {
      this.undoManager.on(event, this.notify);
    }
  }

  get canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  get canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  get state(): HistoryState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoDepth: this.undoManager.undoStack.length,
      redoDepth: this.undoManager.redoStack.length,
    };
  }

  context(random: RandomSource): CommandContext {
    return { doc: this.doc, origin: this.origin, random };
  }

  beginGesture(): Gesture {
    if (this.openGestures === 0) this.undoManager.stopCapturing();
    this.openGestures += 1;
    let ended = false;
    return {
      end: () => {
        if (ended) return;
        ended = true;
        this.openGestures -= 1;
        if (this.openGestures === 0) this.undoManager.stopCapturing();
      },
    };
  }

  run<T>(work: () => T): T {
    const gesture = this.beginGesture();
    try {
      return work();
    } finally {
      gesture.end();
    }
  }

  undo(): boolean {
    this.undoManager.stopCapturing();
    return this.undoManager.undo() !== null;
  }

  redo(): boolean {
    this.undoManager.stopCapturing();
    return this.undoManager.redo() !== null;
  }

  clear(): void {
    this.undoManager.clear();
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.doc.off('beforeTransaction', this.onBeforeTransaction);
    this.undoManager.destroy();
    this.listeners.clear();
  }

  private readonly onBeforeTransaction = (transaction: Y.Transaction): void => {
    if (transaction.origin === this.origin && this.openGestures === 0) {
      this.undoManager.stopCapturing();
    }
  };

  private readonly notify = (): void => {
    const state = this.state;
    for (const listener of [...this.listeners]) listener(state);
  };
}
