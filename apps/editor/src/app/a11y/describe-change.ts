import type { EdgeId, GraphDelta, GraphNode, NodeId, NodeType } from '@coschema/model';
import type { ChangeNote, ChangeSubject } from './announcer';

const MAX_NAME_LENGTH = 40;

const SHAPE_NAMES: Readonly<Record<NodeType, string>> = {
  rect: 'rectangle',
  rounded: 'rounded rectangle',
  ellipse: 'ellipse',
  diamond: 'diamond',
};

export function shapeName(type: NodeType): string {
  return SHAPE_NAMES[type];
}

export function nodeName(node: Pick<GraphNode, 'label' | 'type'>): string {
  const label = node.label.replace(/\s+/gu, ' ').trim();
  if (label === '') return `unnamed ${shapeName(node.type)}`;
  return label.length > MAX_NAME_LENGTH ? `${label.slice(0, MAX_NAME_LENGTH - 1)}…` : label;
}

function edgeName(sourceName: string, targetName: string): string {
  return `${sourceName} to ${targetName}`;
}

export interface DescribeContext {
  readonly actor: string;
  readonly at: number;
  readonly lookupNode: (id: NodeId) => GraphNode | undefined;
}

function samePoint(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameAppearance(previous: GraphNode, next: GraphNode): boolean {
  return (
    previous.type === next.type &&
    samePoint(previous.size, next.size) &&
    JSON.stringify(previous.style) === JSON.stringify(next.style)
  );
}

function note(
  context: DescribeContext,
  kind: ChangeNote['kind'],
  subjects: readonly ChangeSubject[],
): ChangeNote[] {
  return subjects.length === 0 ? [] : [{ actor: context.actor, kind, subjects, at: context.at }];
}

export function describeDelta(delta: GraphDelta, context: DescribeContext): ChangeNote[] {
  const moved: ChangeSubject[] = [];
  const renamed: ChangeSubject[] = [];
  const restyled: ChangeSubject[] = [];
  for (const next of delta.updatedNodes) {
    const previous = delta.previousNodes.get(next.id);
    if (previous === undefined) continue;
    const subject: ChangeSubject = { id: next.id, name: nodeName(next) };
    if (!samePoint(previous.pos, next.pos)) moved.push(subject);
    if (previous.label !== next.label) {
      renamed.push({ ...subject, previousName: nodeName(previous) });
    }
    if (!sameAppearance(previous, next)) restyled.push(subject);
  }
  const added = delta.addedNodes.map((node) => ({ id: node.id, name: nodeName(node) }));
  const deleted: ChangeSubject[] = [];
  for (const id of delta.removedNodes) {
    const previous = delta.previousNodes.get(id);
    if (previous !== undefined) deleted.push({ id, name: nodeName(previous) });
  }
  const connected = delta.addedEdges.map((edge): ChangeSubject => {
    const source = context.lookupNode(edge.source);
    const target = context.lookupNode(edge.target);
    return {
      id: edge.id,
      name: edgeName(
        source === undefined ? 'a node' : nodeName(source),
        target === undefined ? 'a node' : nodeName(target),
      ),
    };
  });
  const disconnected: ChangeSubject[] =
    delta.removedNodes.length > 0
      ? []
      : delta.removedEdges.map((id: EdgeId) => ({ id, name: 'a connection' }));
  return [
    ...note(context, 'added', added),
    ...note(context, 'moved', moved),
    ...note(context, 'renamed', renamed),
    ...note(context, 'restyled', restyled),
    ...note(context, 'connected', connected),
    ...note(context, 'disconnected', disconnected),
    ...note(context, 'deleted', deleted),
  ];
}
