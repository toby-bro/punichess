import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_FEN } from './chess.ts';
import { MistakeMemory } from './memory.ts';

const fakeStorage = (initial: Record<string, string> = {}): Storage => {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
};

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
    assert.deepEqual(new MistakeMemory(fakeStorage()).at(INITIAL_FEN), []);
  });

  it('remembers a mistake against the position it was made in', () => {
    const memory = new MistakeMemory(fakeStorage());
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    const [remembered] = memory.at(INITIAL_FEN);
    assert.ok(remembered);
    assert.equal(remembered.uci, 'e2e4');
    assert.equal(remembered.cpLoss, 150);
    assert.equal(remembered.times, 1);
    assert.deepEqual(memory.at('some other fen'), [], 'and nowhere else');
  });

  it('keeps several different mistakes, worst first', () => {
    const memory = new MistakeMemory(fakeStorage());
    memory.record(INITIAL_FEN, blunder('e2e4', 120));
    memory.record(INITIAL_FEN, blunder('d2d4', 400));
    memory.record(INITIAL_FEN, blunder('g1f3', 250));
    assert.deepEqual(
      memory.at(INITIAL_FEN).map(m => m.uci),
      ['d2d4', 'g1f3', 'e2e4'],
    );
  });

  it('counts a repeated mistake rather than listing it twice', () => {
    const memory = new MistakeMemory(fakeStorage());
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    assert.equal(memory.at(INITIAL_FEN).length, 1);
    assert.equal(memory.at(INITIAL_FEN)[0]?.times, 3, 'falling for it again is worth knowing');
  });

  it('keeps the worst valuation of a move seen more than once', () => {
    const memory = new MistakeMemory(fakeStorage());
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    memory.record(INITIAL_FEN, blunder('e2e4', 600));
    memory.record(INITIAL_FEN, blunder('e2e4', 200));
    assert.equal(memory.at(INITIAL_FEN)[0]?.cpLoss, 600);
  });

  it('does not forget that a move missed a mate', () => {
    const memory = new MistakeMemory(fakeStorage());
    memory.record(INITIAL_FEN, { ...blunder('e2e4', 150), missesMate: true, mateIn: 2 });
    memory.record(INITIAL_FEN, blunder('e2e4', 150));
    const [remembered] = memory.at(INITIAL_FEN);
    assert.equal(remembered?.missesMate, true);
  });

  it('records when it happened', () => {
    const memory = new MistakeMemory(fakeStorage());
    memory.record(INITIAL_FEN, blunder('e2e4', 150), 1_700_000_000_000);
    assert.equal(memory.at(INITIAL_FEN)[0]?.last, 1_700_000_000_000);
  });

  describe('persistence', () => {
    it('survives being reopened', () => {
      const storage = fakeStorage();
      const first = new MistakeMemory(storage);
      first.record(INITIAL_FEN, blunder('e2e4', 150));
      first.record(INITIAL_FEN, blunder('e2e4', 150));

      const second = new MistakeMemory(storage);
      assert.equal(second.at(INITIAL_FEN).length, 1);
      assert.equal(second.at(INITIAL_FEN)[0]?.times, 2);
    });

    it('starts fresh rather than failing on corrupt history', () => {
      const memory = new MistakeMemory(fakeStorage({ 'punichess.mistakes': '{not json' }));
      assert.equal(memory.size, 0);
      assert.doesNotThrow(() => {
        memory.record(INITIAL_FEN, blunder('e2e4', 150));
      });
    });

    it('drops entries that are not usable, keeping the rest', () => {
      const storage = fakeStorage({
        'punichess.mistakes': JSON.stringify({
          positions: {
            [INITIAL_FEN]: [{ uci: 'e2e4', san: 'e4', cpLoss: 150 }, { uci: 'no' }, 42, null],
            bad: 'not an array',
          },
        }),
      });
      const memory = new MistakeMemory(storage);
      assert.equal(memory.at(INITIAL_FEN).length, 1);
      assert.equal(memory.size, 1);
    });

    it('fills in what a stored entry does not say', () => {
      const storage = fakeStorage({
        'punichess.mistakes': JSON.stringify({
          positions: { [INITIAL_FEN]: [{ uci: 'e2e4' }] },
        }),
      });
      const [remembered] = new MistakeMemory(storage).at(INITIAL_FEN);
      assert.ok(remembered);
      assert.equal(remembered.san, 'e2e4', 'the move itself will do as a name');
      assert.equal(remembered.times, 1);
      assert.equal(remembered.cpLoss, 0);
    });

    it('survives storage being unavailable entirely', () => {
      const deny = (): never => {
        throw new Error('denied');
      };
      const broken: Storage = {
        length: 0,
        clear: deny,
        getItem: deny,
        key: deny,
        removeItem: deny,
        setItem: deny,
      };
      const memory = new MistakeMemory(broken);
      assert.doesNotThrow(() => {
        memory.record(INITIAL_FEN, blunder('e2e4', 150));
      });
      assert.equal(memory.at(INITIAL_FEN).length, 1, 'and still works in memory');
    });
  });

  describe('forgetting', () => {
    it('drops one position on request', () => {
      const memory = new MistakeMemory(fakeStorage());
      memory.record(INITIAL_FEN, blunder('e2e4', 150));
      memory.forget(INITIAL_FEN);
      assert.deepEqual(memory.at(INITIAL_FEN), []);
    });

    it('drops everything on request', () => {
      const memory = new MistakeMemory(fakeStorage());
      memory.record(INITIAL_FEN, blunder('e2e4', 150));
      memory.record('another', blunder('d2d4', 150));
      memory.clear();
      assert.equal(memory.size, 0);
    });

    it('drops the least recently seen position once full', () => {
      const memory = new MistakeMemory(fakeStorage(), 2);
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
