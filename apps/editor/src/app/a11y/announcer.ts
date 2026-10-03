import type { Clock, TimerHandle } from '@coschema/sync';

export type ChangeKind =
  'added' | 'moved' | 'renamed' | 'restyled' | 'deleted' | 'connected' | 'disconnected';

export interface ChangeSubject {
  readonly id: string;
  readonly name: string;
  readonly previousName?: string;
}

export interface ChangeNote {
  readonly actor: string;
  readonly kind: ChangeKind;
  readonly subjects: readonly ChangeSubject[];
  readonly at: number;
}

export interface AnnouncerOptions {
  readonly clock: Clock;
  readonly minIntervalMs?: number;
  readonly settleMs?: number;
  readonly staleAfterMs?: number;
  readonly maxPhrases?: number;
  readonly onMessage: (text: string) => void;
}

export const DEFAULT_MIN_INTERVAL_MS = 1500;
export const DEFAULT_SETTLE_MS = 250;
export const DEFAULT_STALE_AFTER_MS = 10_000;
export const DEFAULT_MAX_PHRASES = 3;
export const NON_BREAKING_SPACE = String.fromCharCode(160);

const SUPERSEDED_BY_DELETE: ReadonlySet<ChangeKind> = new Set(['moved', 'renamed', 'restyled']);

function countOf(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function mergeSubjects(
  existing: readonly ChangeSubject[],
  incoming: readonly ChangeSubject[],
): ChangeSubject[] {
  const merged = new Map(existing.map((subject) => [subject.id, subject]));
  for (const subject of incoming) {
    const earlier = merged.get(subject.id);
    const previousName = earlier?.previousName ?? subject.previousName;
    merged.set(subject.id, previousName === undefined ? subject : { ...subject, previousName });
  }
  return [...merged.values()];
}

export function phraseFor(note: ChangeNote): string {
  const [only] = note.subjects;
  const single = note.subjects.length === 1 && only !== undefined;
  const count = note.subjects.length;
  switch (note.kind) {
    case 'added':
      return single ? `added ${only.name}` : `added ${countOf(count, 'node', 'nodes')}`;
    case 'moved':
      return single ? `moved ${only.name}` : `moved ${countOf(count, 'node', 'nodes')}`;
    case 'renamed':
      if (!single) return `renamed ${countOf(count, 'node', 'nodes')}`;
      return only.previousName === undefined || only.previousName === only.name
        ? `renamed ${only.name}`
        : `renamed ${only.previousName} to ${only.name}`;
    case 'restyled':
      return single
        ? `changed the style of ${only.name}`
        : `changed the style of ${countOf(count, 'node', 'nodes')}`;
    case 'deleted':
      return single ? `deleted ${only.name}` : `deleted ${countOf(count, 'node', 'nodes')}`;
    case 'connected':
      return single
        ? `connected ${only.name}`
        : `added ${countOf(count, 'connection', 'connections')}`;
    case 'disconnected':
      return single
        ? 'removed a connection'
        : `removed ${countOf(count, 'connection', 'connections')}`;
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'Someone';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

export function composeMessage(notes: readonly ChangeNote[], maxPhrases: number): string {
  if (notes.length === 0) return '';
  if (notes.length > maxPhrases) {
    const actors = [...new Set(notes.map((note) => note.actor))];
    const total = notes.reduce((sum, note) => sum + note.subjects.length, 0);
    return `${joinNames(actors)} made ${countOf(total, 'change', 'changes')}.`;
  }
  return notes.map((note) => `${note.actor} ${phraseFor(note)}.`).join(' ');
}

export class LiveAnnouncer {
  private queue: ChangeNote[] = [];
  private timer: TimerHandle | undefined;
  private lastSpokenAt = Number.NEGATIVE_INFINITY;
  private lastText = '';
  private repeatToggle = false;
  private readonly minIntervalMs: number;
  private readonly settleMs: number;
  private readonly staleAfterMs: number;
  private readonly maxPhrases: number;

  constructor(private readonly options: AnnouncerOptions) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxPhrases = options.maxPhrases ?? DEFAULT_MAX_PHRASES;
  }

  get queued(): number {
    return this.queue.length;
  }

  enqueue(note: ChangeNote): void {
    const incoming = note.kind === 'deleted' ? this.withoutCancelledAdds(note) : note;
    if (incoming.subjects.length === 0) return;
    this.merge(incoming);
    this.schedule();
  }

  announceNow(text: string): void {
    this.speak(text);
  }

  destroy(): void {
    if (this.timer !== undefined) this.options.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }

  private withoutCancelledAdds(deletion: ChangeNote): ChangeNote {
    const doomed = new Set(deletion.subjects.map((subject) => subject.id));
    const cancelled = new Set<string>();
    const survivors: ChangeNote[] = [];
    for (const note of this.queue) {
      const affected = note.kind === 'added' || SUPERSEDED_BY_DELETE.has(note.kind);
      const kept = affected
        ? note.subjects.filter((subject) => !doomed.has(subject.id))
        : note.subjects;
      if (note.kind === 'added') {
        for (const subject of note.subjects) if (doomed.has(subject.id)) cancelled.add(subject.id);
      }
      if (kept.length > 0) survivors.push({ ...note, subjects: kept });
    }
    this.queue = survivors;
    return {
      ...deletion,
      subjects: deletion.subjects.filter((subject) => !cancelled.has(subject.id)),
    };
  }

  private merge(incoming: ChangeNote): void {
    const last = this.queue[this.queue.length - 1];
    if (last !== undefined && last.actor === incoming.actor && last.kind === incoming.kind) {
      this.queue[this.queue.length - 1] = {
        ...last,
        subjects: mergeSubjects(last.subjects, incoming.subjects),
        at: incoming.at,
      };
      return;
    }
    this.queue.push(incoming);
  }

  private schedule(): void {
    if (this.timer !== undefined || this.queue.length === 0) return;
    const now = this.options.clock.now();
    const wait = Math.max(this.settleMs, this.lastSpokenAt + this.minIntervalMs - now);
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  private flush(): void {
    const now = this.options.clock.now();
    const fresh = this.queue.filter((note) => now - note.at <= this.staleAfterMs);
    this.queue = [];
    const text = composeMessage(fresh, this.maxPhrases);
    if (text !== '') this.speak(text);
  }

  private speak(text: string): void {
    this.lastSpokenAt = this.options.clock.now();
    if (text === this.lastText) this.repeatToggle = !this.repeatToggle;
    else this.repeatToggle = false;
    this.lastText = text;
    this.options.onMessage(this.repeatToggle ? `${text}${NON_BREAKING_SPACE}` : text);
  }
}
