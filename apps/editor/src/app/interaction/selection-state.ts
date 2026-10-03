import { Injectable, computed, signal } from '@angular/core';
import type { EdgeId, NodeId } from '@coschema/model';
import { EMPTY_SELECTION, type Selection } from './types';

@Injectable()
export class SelectionState {
  readonly selection = signal<Selection>(EMPTY_SELECTION);
  private readonly nodeSet = computed(() => new Set(this.selection().nodes));
  private readonly edgeSet = computed(() => new Set(this.selection().edges));
  readonly isEmpty = computed(
    () => this.selection().nodes.length === 0 && this.selection().edges.length === 0,
  );

  hasNode(id: NodeId): boolean {
    return this.nodeSet().has(id);
  }

  hasEdge(id: EdgeId): boolean {
    return this.edgeSet().has(id);
  }

  set(selection: Selection): void {
    this.selection.set(selection);
  }

  clear(): void {
    this.selection.set(EMPTY_SELECTION);
  }

  retain(isNodeAlive: (id: NodeId) => boolean, isEdgeAlive: (id: EdgeId) => boolean): void {
    const current = this.selection();
    const nodes = current.nodes.filter(isNodeAlive);
    const edges = current.edges.filter(isEdgeAlive);
    if (nodes.length === current.nodes.length && edges.length === current.edges.length) return;
    this.selection.set({ nodes, edges });
  }
}
