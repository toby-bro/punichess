import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SETTINGS,
  PIECE_SETS,
  PRESETS,
  loadSettings,
  parseSettings,
  saveSettings,
  withColour,
  withPieceSet,
  withSaveOnNew,
  withSetting,
} from './settings.ts';

/** A localStorage good enough to exercise the persistence paths. */
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

describe('parseSettings', () => {
  it('falls back to the defaults for anything unusable', () => {
    for (const junk of [null, undefined, 42, 'nonsense', [], {}]) {
      assert.deepEqual(parseSettings(junk), DEFAULT_SETTINGS);
    }
  });

  it('keeps valid values', () => {
    const parsed = parseSettings({ targetAcpl: 40, blunderChance: 0.5 });
    assert.equal(parsed.targetAcpl, 40);
    assert.equal(parsed.blunderChance, 0.5);
  });

  it('clamps values that are out of range', () => {
    const parsed = parseSettings({ targetAcpl: 9999, blunderChance: -3, maxMateDepth: 99 });
    assert.equal(parsed.targetAcpl, 200);
    assert.equal(parsed.blunderChance, 0);
    assert.equal(parsed.maxMateDepth, 5);
  });

  it('ignores fields that are not finite numbers', () => {
    const parsed = parseSettings({ targetAcpl: 'lots', quietBand: NaN, blunderMin: Infinity });
    assert.equal(parsed.targetAcpl, DEFAULT_SETTINGS.targetAcpl);
    assert.equal(parsed.quietBand, DEFAULT_SETTINGS.quietBand);
    assert.equal(parsed.blunderMin, DEFAULT_SETTINGS.blunderMin);
  });

  it('refuses to leave the blunder band inverted', () => {
    const parsed = parseSettings({ blunderMin: 400, blunderMax: 100 });
    assert.ok(parsed.blunderMax >= parsed.blunderMin);
  });
});

describe('playAs', () => {
  it('defaults to White', () => {
    assert.equal(DEFAULT_SETTINGS.playAs, 'white');
  });

  it('keeps a valid colour', () => {
    assert.equal(parseSettings({ playAs: 'black' }).playAs, 'black');
    assert.equal(parseSettings({ playAs: 'white' }).playAs, 'white');
  });

  it('falls back for anything that is not a colour', () => {
    for (const junk of ['grey', '', 0, null, undefined, {}]) {
      assert.equal(parseSettings({ playAs: junk }).playAs, 'white');
    }
  });

  it('keeps the colour already in force when the stored value is unusable', () => {
    const asBlack = withColour(DEFAULT_SETTINGS, 'black');
    assert.equal(parseSettings({ playAs: 'nonsense' }, asBlack).playAs, 'black');
  });

  it('switches sides without touching anything else', () => {
    const switched = withColour(withSetting(DEFAULT_SETTINGS, 'targetAcpl', 55), 'black');
    assert.equal(switched.playAs, 'black');
    assert.equal(switched.targetAcpl, 55);
  });

  it('survives a round trip through storage', () => {
    const storage = fakeStorage();
    saveSettings(withColour(DEFAULT_SETTINGS, 'black'), storage);
    assert.equal(loadSettings(storage).playAs, 'black');
  });
});

describe('minMoveMs', () => {
  it('makes the bot pause by default, since answering instantly hurries you', () => {
    assert.ok(DEFAULT_SETTINGS.minMoveMs > 0);
  });

  it('can be turned off entirely', () => {
    assert.equal(withSetting(DEFAULT_SETTINGS, 'minMoveMs', 0).minMoveMs, 0);
  });

  it('is clamped to something survivable', () => {
    assert.equal(withSetting(DEFAULT_SETTINGS, 'minMoveMs', -500).minMoveMs, 0);
    assert.equal(withSetting(DEFAULT_SETTINGS, 'minMoveMs', 10 ** 9).minMoveMs, 10_000);
  });
});

describe('withSetting', () => {
  it('changes one field and leaves the rest alone', () => {
    const changed = withSetting(DEFAULT_SETTINGS, 'targetAcpl', 60);
    assert.equal(changed.targetAcpl, 60);
    assert.equal(changed.quietBand, DEFAULT_SETTINGS.quietBand);
  });

  it('clamps the change', () => {
    assert.equal(withSetting(DEFAULT_SETTINGS, 'blunderChance', 5).blunderChance, 1);
  });
});

describe('presets', () => {
  it('all produce valid settings', () => {
    for (const preset of PRESETS) {
      const settings = parseSettings(preset.settings);
      assert.deepEqual(settings, parseSettings(settings), `${preset.label} is not stable`);
      assert.ok(settings.blunderMax >= settings.blunderMin);
    }
  });

  it('are ordered from most to least accurate', () => {
    const sharp = parseSettings(PRESETS[0]?.settings);
    const loose = parseSettings(PRESETS[2]?.settings);
    assert.ok(sharp.targetAcpl < loose.targetAcpl);
  });
});

describe('storage', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const settings = withSetting(DEFAULT_SETTINGS, 'targetAcpl', 42);
    saveSettings(settings, storage);
    assert.deepEqual(loadSettings(storage), settings);
  });

  it('returns the defaults when nothing is stored', () => {
    assert.deepEqual(loadSettings(fakeStorage()), DEFAULT_SETTINGS);
  });

  it('survives corrupt stored data', () => {
    const storage = fakeStorage({ 'punichess.settings': '{not json' });
    assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
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
    assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
    assert.doesNotThrow(() => {
      saveSettings(DEFAULT_SETTINGS, broken);
    });
  });
});

describe('saveOnNew', () => {
  it('keeps the previous game by default', () => {
    assert.equal(DEFAULT_SETTINGS.saveOnNew, true);
  });

  it('turns off and back on', () => {
    const off = withSaveOnNew(DEFAULT_SETTINGS, false);
    assert.equal(off.saveOnNew, false);
    assert.equal(withSaveOnNew(off, true).saveOnNew, true);
  });

  it('keeps what is already in force when the stored value is unusable', () => {
    const off = withSaveOnNew(DEFAULT_SETTINGS, false);
    assert.equal(parseSettings({ saveOnNew: 'no' }, off).saveOnNew, false);
    assert.equal(parseSettings({}, off).saveOnNew, false);
  });

  it('survives a round trip through storage', () => {
    const storage = fakeStorage();
    saveSettings(withSaveOnNew(DEFAULT_SETTINGS, false), storage);
    assert.equal(loadSettings(storage).saveOnNew, false);
  });
});

describe('pieceSet', () => {
  it('defaults to one that ships', () => {
    assert.ok(PIECE_SETS.includes(DEFAULT_SETTINGS.pieceSet));
  });

  it('accepts any set that ships', () => {
    for (const set of PIECE_SETS) {
      assert.equal(withPieceSet(DEFAULT_SETTINGS, set).pieceSet, set);
    }
  });

  it('refuses one that does not', () => {
    // The value becomes a class name. A set removed since it was chosen must not
    // leave the board with no pieces on it.
    for (const junk of ['staunty', '', 42, null, undefined, {}]) {
      assert.equal(parseSettings({ pieceSet: junk }).pieceSet, DEFAULT_SETTINGS.pieceSet);
    }
  });

  it('keeps the one in force when the stored value is unusable', () => {
    const chosen = withPieceSet(DEFAULT_SETTINGS, 'celtic');
    assert.equal(parseSettings({ pieceSet: 'nonsense' }, chosen).pieceSet, 'celtic');
  });

  it('survives a round trip through storage', () => {
    const storage = fakeStorage();
    saveSettings(withPieceSet(DEFAULT_SETTINGS, 'mpchess'), storage);
    assert.equal(loadSettings(storage).pieceSet, 'mpchess');
  });

  it('leaves the other settings alone', () => {
    const changed = withPieceSet(withSetting(DEFAULT_SETTINGS, 'targetAcpl', 55), 'fantasy');
    assert.equal(changed.targetAcpl, 55);
  });
});
