import { History, createNode, getNodes, moveNodes } from '@coschema/model';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../testing/manual-clock';
import { seededRandom } from '../testing/seeded-random';
import { MoveBurst } from './move-burst';

function setup() {
  const doc = new Y.Doc();
  const history = new History(doc);
  const context = history.context(seededRandom(3));
  const id = createNode(context, { type: 'rect', pos: [0, 0] });
  history.clear();
  const clock = new ManualClock();
  const burst = new MoveBurst(history, clock, 400);
  const nudge = (repeat: boolean, x: number): void => {
    burst.run(repeat, () => {
      moveNodes(context, [{ id, pos: [x, 0] }]);
    });
  };
  return { history, burst, clock, nudge, doc, id };
}

describe('MoveBurst', () => {
  it('makes every separate key press its own undo step', () => {
    const { history, nudge } = setup();
    nudge(false, 24);
    nudge(false, 48);
    nudge(false, 72);
    expect(history.state.undoDepth).toBe(3);
  });

  it('merges key repeats into the press that started them', () => {
    const { history, nudge, clock } = setup();
    nudge(false, 24);
    clock.advance(100);
    nudge(true, 48);
    clock.advance(100);
    nudge(true, 72);
    expect(history.state.undoDepth).toBe(1);
    history.undo();
    expect(history.canUndo).toBe(false);
  });

  it('closes the burst after the window passes without a key', () => {
    const { history, nudge, clock, burst } = setup();
    nudge(false, 24);
    expect(burst.open).toBe(true);
    clock.advance(401);
    expect(burst.open).toBe(false);
    nudge(true, 48);
    expect(history.state.undoDepth).toBe(2);
  });

  it('undoes a whole burst in one step', () => {
    const { history, nudge, clock, doc, id } = setup();
    nudge(false, 24);
    clock.advance(50);
    nudge(true, 48);
    clock.advance(50);
    nudge(true, 72);
    history.undo();
    expect(getNodes(doc).get(id)?.get('pos')).toEqual([0, 0]);
  });

  it('ends the gesture even when the work throws', () => {
    const { burst, history } = setup();
    expect(() => {
      burst.run(false, () => {
        throw new Error('boom');
      });
    }).toThrow('boom');
    burst.end();
    expect(burst.open).toBe(false);
    expect(history.state.undoDepth).toBe(0);
  });
});
