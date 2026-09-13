import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_FEN } from './chess.ts';
import { MistakeMemory } from './memory.ts';

const blunder = (uci: string, cpLoss: number) => ({
  uci,
  san: uci,
  cpLoss,
  missesMate: false,
  hangsMate: false,
  stalemate: false,
  mateIn: undefined,
});

describe('MistakeMemory', () => {
  it('remembers nothing about a position it has not seen', () => {
    assert.deepEqual(new MistakeMemory().at(INITIAL_FEN), []);
  });

  it('remembers a mistake against the position it was made in', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    const [remembered] = memory.at(INITIAL_FEN);
    assert.ok(remembered);
    assert.equal(remembered.uci, 'e2e4');
    assert.equal(remembered.cpLoss, 150);
    assert.equal(remembered.times, 1);
    assert.deepEqual(memory.at('some other fen'), [], 'and nowhere else');
  });

  it('keeps several different mistakes, worst first', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, blunder('e2e4', 120));
    memory.record(INITIAL_FEN, blunder('d2d4', 400));
    memory.record(INITIAL_FEN, blunder('g1f3', 250));
    assert.deepEqual(
      memory.at(INITIAL_FEN).map(m => m.uci),
      ['d2d4', 'g1f3', 'e2e4'],
    );
  });

  it('counts a repeated mistake rather than listing it twice', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    assert.equal(memory.at(INITIAL_FEN).length, 1);
    assert.equal(memory.at(INITIAL_FEN)[0]?.times, 3, 'falling for it again is worth knowing');
  });

  it('keeps the worst valuation of a move seen more than once', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    memory.record(INITIAL_FEN, blunder('e2e4', 600));
    memory.record(INITIAL_FEN, blunder('e2e4', 200));
    assert.equal(memory.at(INITIAL_FEN)[0]?.cpLoss, 600);
  });

  it('does not forget that a move missed a mate', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, { ...blunder('e2e4', 150), missesMate: true, mateIn: 2 });
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    const [remembered] = memory.at(INITIAL_FEN);
    assert.equal(remembered?.missesMate, true);
  });

  it('records when it happened', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, blunder('e2e4', 150), 1_700_000_000_000);
    assert.equal(memory.at(INITIAL_FEN)[0]?.last, 1_700_000_000_000);
  });

  describe('travelling with a game', () => {
    it('round-trips through the shape a saved game stores', () => {
      const first = new MistakeMemory();
      first.record(INITIAL_FEN, blunder('e2e4', 150));
      first.record(INITIAL_FEN, blunder('e2e4', 150));
      first.record('another fen', blunder('d2d4', 300));

      const second = new MistakeMemory();
      second.restore(first.toStored());
      assert.equal(second.size, 2);
      assert.equal(second.at(INITIAL_FEN)[0]?.times, 2);
      assert.equal(second.at('another fen')[0]?.cpLoss, 300);
    });

    it('starts a new game knowing nothing', () => {
      const memory = new MistakeMemory();
      memory.record(INITIAL_FEN, blunder('e2e4', 150));
      memory.clear();
      assert.deepEqual(memory.at(INITIAL_FEN), [], 'last game is not this game');
    });

    it('replaces rather than merges, so one game cannot leak into another', () => {
      const memory = new MistakeMemory();
      memory.record(INITIAL_FEN, blunder('e2e4', 150));
      memory.restore({ other: [{ uci: 'd2d4', san: 'd4', cpLoss: 100 }] });
      assert.deepEqual(memory.at(INITIAL_FEN), []);
      assert.equal(memory.at('other').length, 1);
    });

    it('shrugs off anything that is not a record of mistakes', () => {
      const memory = new MistakeMemory();
      for (const junk of [null, undefined, 42, 'nonsense', []]) {
        assert.doesNotThrow(() => {
          memory.restore(junk);
        });
        assert.equal(memory.size, 0);
      }
    });

    it('drops entries that are not usable, keeping the rest', () => {
      const memory = new MistakeMemory();
      memory.restore({
        [INITIAL_FEN]: [{ uci: 'e2e4', san: 'e4', cpLoss: 150 }, { uci: 'no' }, 42, null],
        bad: 'not an array',
      });
      assert.equal(memory.at(INITIAL_FEN).length, 1);
      assert.equal(memory.size, 1);
    });

    it('fills in what a stored entry does not say', () => {
      const memory = new MistakeMemory();
      memory.restore({ [INITIAL_FEN]: [{ uci: 'e2e4' }] });
      const [remembered] = memory.at(INITIAL_FEN);
      assert.ok(remembered);
      assert.equal(remembered.san, 'e2e4', 'the move itself will do as a name');
      assert.equal(remembered.times, 1);
      assert.equal(remembered.cpLoss, 0);
    });
  });

  describe('forgetting', () => {
    it('drops one position on request', () => {
      const memory = new MistakeMemory();
      memory.record(INITIAL_FEN, blunder('e2e4', 150));
      memory.forget(INITIAL_FEN);
      assert.deepEqual(memory.at(INITIAL_FEN), []);
    });

    it('drops everything on request', () => {
      const memory = new MistakeMemory();
      memory.record(INITIAL_FEN, blunder('e2e4', 150));
      memory.record('another', blunder('d2d4', 150));
      memory.clear();
      assert.equal(memory.size, 0);
    });

    it('drops the least recently seen position once full', () => {
      const memory = new MistakeMemory(2);
      memory.record('a', blunder('e2e4', 150));
      memory.record('b', blunder('e2e4', 150));
      memory.record('a', blunder('d2d4', 150));
      memory.record('c', blunder('e2e4', 150));
      assert.equal(memory.size, 2);
      assert.deepEqual(memory.at('b'), [], 'b was the one nobody came back to');
      assert.equal(memory.at('a').length, 2);
    });
  });
});

describe('mistakes you never actually played', () => {
  it('are kept, because being stopped is what records them', () => {
    const memory = new MistakeMemory();
    // Stopped for it, thought better of it, played something else. The move was
    // never part of the game, and it is exactly the thing worth remembering.
    memory.record(INITIAL_FEN, blunder('e2e4', 250));

    const stored = memory.toStored();
    assert.equal(Object.keys(stored).length, 1);
    assert.equal(stored[INITIAL_FEN]?.[0]?.uci, 'e2e4');

    const reopened = new MistakeMemory();
    reopened.restore(stored);
    assert.equal(reopened.at(INITIAL_FEN)[0]?.uci, 'e2e4');
  });

  it('keeps every distinct one at a position', () => {
    const memory = new MistakeMemory();
    memory.record(INITIAL_FEN, blunder('e2e4', 250));
    memory.record(INITIAL_FEN, blunder('d2d4', 180));
    memory.record(INITIAL_FEN, blunder('g1f3', 120));
    assert.equal(memory.toStored()[INITIAL_FEN]?.length, 3);
  });
});
