import * as Y from 'yjs';
import {
  editLabel,
  getLabelText,
  type CommandContext,
  type Gesture,
  type History,
  type NodeId,
} from '@coschema/model';

export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export type RemoteChangeListener = (value: string, selection: TextSelection) => void;

export class LabelEditSession {
  private readonly gesture: Gesture;
  private anchor: Y.RelativePosition | undefined;
  private head: Y.RelativePosition | undefined;
  private closed = false;

  private constructor(
    private readonly doc: Y.Doc,
    private readonly text: Y.Text,
    private readonly context: CommandContext,
    private readonly nodeId: NodeId,
    history: History,
    private readonly onRemoteChange: RemoteChangeListener,
  ) {
    this.gesture = history.beginGesture();
    this.text.observe(this.onTextChange);
    this.remember({ start: this.text.length, end: this.text.length });
  }

  static open(
    doc: Y.Doc,
    history: History,
    context: CommandContext,
    nodeId: NodeId,
    onRemoteChange: RemoteChangeListener,
  ): LabelEditSession | undefined {
    const text = getLabelText(doc, nodeId);
    if (text === undefined) return undefined;
    return new LabelEditSession(doc, text, context, nodeId, history, onRemoteChange);
  }

  get value(): string {
    return this.text.toJSON();
  }

  type(value: string, selection: TextSelection): void {
    if (this.closed) return;
    editLabel(this.context, this.nodeId, value);
    this.remember(selection);
  }

  remember(selection: TextSelection): void {
    const length = this.text.length;
    const start = Math.min(selection.start, length);
    const end = Math.min(selection.end, length);
    this.anchor = Y.createRelativePositionFromTypeIndex(this.text, start);
    this.head = Y.createRelativePositionFromTypeIndex(this.text, end);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.text.unobserve(this.onTextChange);
    this.gesture.end();
  }

  private resolve(position: Y.RelativePosition | undefined): number {
    if (position === undefined) return this.text.length;
    return (
      Y.createAbsolutePositionFromRelativePosition(position, this.doc)?.index ?? this.text.length
    );
  }

  private readonly onTextChange = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
    if (transaction.origin === this.context.origin) return;
    const start = this.resolve(this.anchor);
    const end = this.resolve(this.head);
    this.onRemoteChange(this.text.toJSON(), { start, end });
    this.remember({ start, end });
  };
}
