import { describe, expect, it } from 'vitest';
import { ManualClock } from '../testing/manual-clock';
import {
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_SETTLE_MS,
  LiveAnnouncer,
  NON_BREAKING_SPACE,
  composeMessage,
  phraseFor,
  type ChangeKind,
  type ChangeNote,
} from './announcer';

function note(kind: ChangeKind, names: readonly string[], actor = 'Anna', at = 0): ChangeNote {
  return {
    actor,
    kind,
    at,
    subjects: names.map((name) => ({ id: `id-${name}`, name })),
  };
}

function setup(options: { staleAfterMs?: number } = {}) {
  const clock = new ManualClock();
  const messages: string[] = [];
  const announcer = new LiveAnnouncer({
    clock,
    onMessage: (text) => messages.push(text),
    ...options,
  });
  const enqueue = (next: Omit<ChangeNote, 'at'>): void => {
    announcer.enqueue({ ...next, at: clock.now() });
  };
  return { clock, messages, announcer, enqueue };
}

describe('phraseFor', () => {
  it('names a single node and counts several', () => {
    expect(phraseFor(note('moved', ['Pump 3']))).toBe('moved Pump 3');
    expect(phraseFor(note('moved', ['A', 'B', 'C']))).toBe('moved 3 nodes');
    expect(phraseFor(note('added', ['Valve']))).toBe('added Valve');
    expect(phraseFor(note('added', ['A', 'B']))).toBe('added 2 nodes');
    expect(phraseFor(note('deleted', ['Valve']))).toBe('deleted Valve');
    expect(phraseFor(note('deleted', ['A', 'B']))).toBe('deleted 2 nodes');
  });

  it('describes renames with the old name when it is known', () => {
    const renamed: ChangeNote = {
      actor: 'Anna',
      kind: 'renamed',
      at: 0,
      subjects: [{ id: 'x', name: 'Pump 3', previousName: 'Pump 2' }],
    };
    expect(phraseFor(renamed)).toBe('renamed Pump 2 to Pump 3');
    const unchanged: ChangeNote = {
      ...renamed,
      subjects: [{ id: 'x', name: 'Pump 3', previousName: 'Pump 3' }],
    };
    expect(phraseFor(unchanged)).toBe('renamed Pump 3');
    expect(phraseFor(note('renamed', ['Pump 3']))).toBe('renamed Pump 3');
    expect(phraseFor(note('renamed', ['A', 'B']))).toBe('renamed 2 nodes');
  });

  it('describes connections and style changes', () => {
    expect(phraseFor(note('connected', ['A to B']))).toBe('connected A to B');
    expect(phraseFor(note('connected', ['A to B', 'B to C']))).toBe('added 2 connections');
    expect(phraseFor(note('disconnected', ['a connection']))).toBe('removed a connection');
    expect(phraseFor(note('disconnected', ['x', 'y']))).toBe('removed 2 connections');
    expect(phraseFor(note('restyled', ['Pump']))).toBe('changed the style of Pump');
    expect(phraseFor(note('restyled', ['A', 'B']))).toBe('changed the style of 2 nodes');
  });
});

describe('composeMessage', () => {
  it('returns nothing for no notes', () => {
    expect(composeMessage([], 3)).toBe('');
  });

  it('joins a few notes into sentences', () => {
    const text = composeMessage(
      [note('moved', ['Pump 3']), note('deleted', ['Valve'], 'Bartek')],
      3,
    );
    expect(text).toBe('Anna moved Pump 3. Bartek deleted Valve.');
  });

  it('summarises a flood instead of reading every sentence', () => {
    const notes = [
      note('moved', ['A', 'B']),
      note('deleted', ['C'], 'Bartek'),
      note('added', ['D'], 'Celina'),
      note('renamed', ['E']),
    ];
    expect(composeMessage(notes, 3)).toBe('Anna, Bartek and Celina made 5 changes.');
    expect(
      composeMessage(
        [
          note('added', ['A']),
          note('moved', ['A']),
          note('deleted', ['A']),
          note('renamed', ['A']),
        ],
        3,
      ),
    ).toBe('Anna made 4 changes.');
  });
});

describe('LiveAnnouncer', () => {
  it('waits for a short settle time so a burst is read once', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('moved', ['Pump 3']));
    clock.advance(DEFAULT_SETTLE_MS - 1);
    expect(messages).toEqual([]);
    clock.advance(1);
    expect(messages).toEqual(['Anna moved Pump 3.']);
  });

  it('merges a run of the same action by the same person', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('moved', ['A']));
    enqueue(note('moved', ['B']));
    enqueue(note('moved', ['C']));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toEqual(['Anna moved 3 nodes.']);
  });

  it('keeps the first previous name and the last new name when a label changes repeatedly', () => {
    const { clock, messages, announcer } = setup();
    const rename = (name: string, previousName: string): ChangeNote => ({
      actor: 'Anna',
      kind: 'renamed',
      at: clock.now(),
      subjects: [{ id: 'x', name, previousName }],
    });
    announcer.enqueue(rename('P', 'Pump'));
    announcer.enqueue(rename('Pu', 'P'));
    announcer.enqueue(rename('Pum', 'Pu'));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toEqual(['Anna renamed Pump to Pum.']);
  });

  it('does not merge different people or different actions', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('moved', ['A']));
    enqueue(note('moved', ['B'], 'Bartek'));
    enqueue(note('deleted', ['C']));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toEqual(['Anna moved A. Bartek moved B. Anna deleted C.']);
  });

  it('speaks at most once every interval and merges what arrived in between', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('moved', ['A']));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toHaveLength(1);
    clock.advance(200);
    enqueue(note('added', ['B']));
    clock.advance(DEFAULT_MIN_INTERVAL_MS - 200 - 1);
    expect(messages).toHaveLength(1);
    clock.advance(1);
    expect(messages).toEqual(['Anna moved A.', 'Anna added B.']);
  });

  it('forgets a change that was deleted before it was read', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('moved', ['A']));
    enqueue(note('renamed', ['A']));
    enqueue(note('moved', ['B']));
    enqueue(note('deleted', ['A'], 'Bartek'));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toEqual(['Anna moved B. Bartek deleted A.']);
  });

  it('says nothing for a node that was added and deleted before the next reading', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('added', ['A']));
    enqueue(note('deleted', ['A'], 'Bartek'));
    clock.advance(DEFAULT_MIN_INTERVAL_MS);
    expect(messages).toEqual([]);
  });

  it('keeps the other nodes of an added note when only one of them is deleted', () => {
    const { clock, messages, enqueue } = setup();
    enqueue(note('added', ['A', 'B']));
    enqueue(note('deleted', ['A'], 'Bartek'));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toEqual(['Anna added B.']);
  });

  it('drops notes that went stale while waiting', () => {
    const { clock, messages, announcer } = setup({ staleAfterMs: 100 });
    announcer.enqueue({ ...note('moved', ['A']), at: -500 });
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toEqual([]);
    expect(announcer.queued).toBe(0);
  });

  it('ignores a note without subjects', () => {
    const { clock, messages, announcer } = setup();
    announcer.enqueue({ actor: 'Anna', kind: 'moved', subjects: [], at: 0 });
    clock.advance(DEFAULT_MIN_INTERVAL_MS);
    expect(messages).toEqual([]);
  });

  it('announces a local message at once and counts it towards the interval', () => {
    const { clock, messages, announcer, enqueue } = setup();
    announcer.announceNow('Connection cancelled.');
    expect(messages).toEqual(['Connection cancelled.']);
    enqueue(note('moved', ['A']));
    clock.advance(DEFAULT_SETTLE_MS);
    expect(messages).toHaveLength(1);
    clock.advance(DEFAULT_MIN_INTERVAL_MS);
    expect(messages).toEqual(['Connection cancelled.', 'Anna moved A.']);
  });

  it('changes the text when the same sentence repeats so a screen reader reads it again', () => {
    const { messages, announcer } = setup();
    announcer.announceNow('Nothing to undo.');
    announcer.announceNow('Nothing to undo.');
    announcer.announceNow('Nothing to undo.');
    expect(messages[0]).toBe('Nothing to undo.');
    expect(messages[1]).toBe(`Nothing to undo.${NON_BREAKING_SPACE}`);
    expect(messages[2]).toBe('Nothing to undo.');
  });

  it('stops after destroy', () => {
    const { clock, messages, announcer, enqueue } = setup();
    enqueue(note('moved', ['A']));
    announcer.destroy();
    clock.advance(DEFAULT_MIN_INTERVAL_MS);
    expect(messages).toEqual([]);
    expect(announcer.queued).toBe(0);
  });
});
