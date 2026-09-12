import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SETTINGS,
  PRESETS,
  loadSettings,
  parseSettings,
  saveSettings,
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
    const storage = fakeStorage({ 'spot-the-blunder.settings': '{not json' });
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
