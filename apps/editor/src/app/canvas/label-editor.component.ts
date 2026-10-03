import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  untracked,
  viewChild,
  Injector,
} from '@angular/core';
import { DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { LabelEditSession } from '../interaction/label-session';
import { ViewportState } from './viewport-state';

const DEFAULT_FONT_SIZE = 14;
const MIN_EDITOR_WIDTH = 64;

@Component({
  selector: 'cs-label-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .field {
      position: absolute;
      box-sizing: border-box;
      margin: 0;
      padding: 0 4px;
      border: 2px solid var(--cs-accent, #1f4fd8);
      border-radius: 4px;
      background: var(--cs-node-fill, #ffffff);
      color: var(--cs-node-text, #1b1f2a);
      font-family: system-ui, sans-serif;
      text-align: center;
      outline: none;
    }
    .field[hidden] {
      display: none;
    }
  `,
  template: `
    <input
      #field
      class="field"
      type="text"
      aria-label="Node label"
      [hidden]="box() === undefined"
      [style.left.px]="box()?.left"
      [style.top.px]="box()?.top"
      [style.width.px]="box()?.width"
      [style.height.px]="box()?.height"
      [style.font-size.px]="box()?.fontSize"
      (input)="onInput()"
      (select)="onSelect()"
      (keyup)="onSelect()"
      (keydown)="onKeydown($event)"
      (blur)="onBlur()"
    />
  `,
})
export class LabelEditorComponent {
  private readonly session = inject(DocumentSession);
  private readonly controller = inject(InteractionController);
  private readonly viewport = inject(ViewportState);
  private readonly injector = inject(Injector);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  readonly closed = output<undefined>();
  private active: LabelEditSession | undefined;

  protected readonly box = computed(() => {
    const id = this.controller.editingNode();
    if (id === undefined) return undefined;
    const node = this.session.graph.node(id)();
    if (node === undefined) return undefined;
    const { x, y, zoom } = this.viewport.viewport();
    const width = Math.max(MIN_EDITOR_WIDTH, node.size[0] * zoom);
    const height = Math.min(
      node.size[1] * zoom,
      Math.max(28, (node.style.fontSize ?? DEFAULT_FONT_SIZE) * zoom * 2),
    );
    return {
      left: node.pos[0] * zoom + x + (node.size[0] * zoom - width) / 2,
      top: node.pos[1] * zoom + y + (node.size[1] * zoom - height) / 2,
      width,
      height,
      fontSize: (node.style.fontSize ?? DEFAULT_FONT_SIZE) * zoom,
    };
  });

  constructor() {
    effect(() => {
      const id = this.controller.editingNode();
      untracked(() => {
        this.close();
        if (id !== undefined) this.open(id);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.close();
    });
  }

  protected onInput(): void {
    const input = this.field().nativeElement;
    this.active?.type(input.value, this.selectionOf(input));
  }

  protected onSelect(): void {
    const input = this.field().nativeElement;
    this.active?.remember(this.selectionOf(input));
  }

  protected onKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      this.controller.endLabelEdit();
      this.closed.emit(undefined);
    }
  }

  protected onBlur(): void {
    if (this.active !== undefined) this.controller.endLabelEdit();
  }

  private open(id: string): void {
    const input = this.field().nativeElement;
    const opened = LabelEditSession.open(
      this.session.doc,
      this.session.history,
      this.session.context,
      id,
      (value, selection) => {
        input.value = value;
        input.setSelectionRange(selection.start, selection.end);
      },
    );
    if (opened === undefined) {
      this.controller.endLabelEdit();
      return;
    }
    this.active = opened;
    input.value = opened.value;
    afterNextRender(
      () => {
        input.focus({ preventScroll: true });
        input.select();
        opened.remember({ start: 0, end: input.value.length });
      },
      { injector: this.injector },
    );
  }

  private close(): void {
    const closing = this.active;
    this.active = undefined;
    closing?.close();
  }

  private selectionOf(input: HTMLInputElement): { start: number; end: number } {
    return { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
  }
}
