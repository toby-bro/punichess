/**
 * Tunable behaviour, persisted between games.
 *
 * Everything the bot decides is driven from here rather than from constants, so
 * the same code plays a forgiving sparring partner or a merciless one.
 */

/** Where settings live in localStorage. */
const STORAGE_KEY = 'punichess.settings';

import type { Color } from 'chessops/types';

/** The fields that are plain tunable numbers, as opposed to a choice. */
export type NumericSetting = Exclude<keyof Settings, 'playAs'>;

export interface Settings {
  /** The colour you play. The bot takes the other one. */
  readonly playAs: Color;
  /**
   * The average centipawn loss the bot aims for across its honest moves.
   * This is the strength dial: 0 is best-move play, 60 is a distracted club
   * player. It is a target for the *average*, not a cap on any one move.
   */
  readonly targetAcpl: number;
  /** Hard ceiling on any single honest move's loss, whatever the target. */
  readonly quietBand: number;
  /** A deliberate error costs at least this much... */
  readonly blunderMin: number;
  /** ...and at most this much. */
  readonly blunderMax: number;
  /** Chance of erring on purpose on any eligible move. */
  readonly blunderChance: number;
  /** How many deliberate errors at most in one game. */
  readonly blundersPerGame: number;
  /** Deliberate errors only start after this many plies. */
  readonly blunderFromPly: number;
  /** Share of deliberate errors that hand you a forced mate instead. */
  readonly mateTrapShare: number;
  /** The longest forced mate the bot will hand you. */
  readonly maxMateDepth: number;
  /** Centipawn loss at which your own move gets you stopped. */
  readonly ownBlunderCp: number;
  /** Centipawn loss at which failing to punish gets you stopped. */
  readonly missedPunishCp: number;
}

export const DEFAULT_SETTINGS: Settings = {
  playAs: 'white',
  targetAcpl: 25,
  quietBand: 100,
  blunderMin: 100,
  blunderMax: 300,
  blunderChance: 0.25,
  blundersPerGame: 3,
  blunderFromPly: 16,
  mateTrapShare: 0.3,
  maxMateDepth: 3,
  ownBlunderCp: 110,
  missedPunishCp: 50,
};

/** Bounds for each field, used to clamp both stored and user-entered values. */
const LIMITS = {
  targetAcpl: [0, 200],
  quietBand: [10, 400],
  blunderMin: [30, 600],
  blunderMax: [50, 1200],
  blunderChance: [0, 1],
  blundersPerGame: [0, 20],
  blunderFromPly: [0, 60],
  mateTrapShare: [0, 1],
  maxMateDepth: [1, 5],
  ownBlunderCp: [20, 500],
  missedPunishCp: [10, 400],
} as const satisfies Record<NumericSetting, readonly [number, number]>;

/** Ready-made strength levels, in terms people can reason about. */
export interface Preset {
  readonly label: string;
  readonly description: string;
  readonly settings: Partial<Settings>;
}

export const PRESETS: readonly Preset[] = [
  {
    label: 'Sharp',
    description: 'Plays close to best. Rare errors, and they are small.',
    settings: { targetAcpl: 8, quietBand: 60, blunderChance: 0.12, blundersPerGame: 2 },
  },
  {
    label: 'Club',
    description: 'Loses a little on most moves, errs a few times a game.',
    settings: { targetAcpl: 25, quietBand: 100, blunderChance: 0.25, blundersPerGame: 3 },
  },
  {
    label: 'Loose',
    description: 'Drifts constantly and hands you plenty to punish.',
    settings: { targetAcpl: 55, quietBand: 160, blunderChance: 0.4, blundersPerGame: 5 },
  },
  {
    label: 'Mate hunt',
    description: 'Most of its errors walk into a forced mate for you to find.',
    settings: {
      targetAcpl: 35,
      quietBand: 120,
      blunderChance: 0.45,
      blundersPerGame: 6,
      mateTrapShare: 0.8,
    },
  },
];

const clamp = (value: number, [low, high]: readonly [number, number]): number =>
  Math.max(low, Math.min(high, value));

/**
 * Build valid settings from anything at all.
 *
 * Stored settings outlive the code that wrote them, so every field is taken
 * only if it is a finite number, and clamped into range regardless.
 */
export function parseSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result = { ...base };

  const playAs = source['playAs'];
  result.playAs = playAs === 'white' || playAs === 'black' ? playAs : base.playAs;

  for (const key of Object.keys(LIMITS) as NumericSetting[]) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = clamp(value, LIMITS[key]);
    } else {
      result[key] = clamp(base[key], LIMITS[key]);
    }
  }
  // A blunder band that is the wrong way round would silently never match.
  if (result.blunderMax < result.blunderMin) {
    result.blunderMax = result.blunderMin;
  }
  return result;
}

/** Apply a numeric change, clamped and consistent. */
export const withSetting = (settings: Settings, key: NumericSetting, value: number): Settings =>
  parseSettings({ ...settings, [key]: value }, settings);

/** Switch sides. Callers are expected to start a new game afterwards. */
export const withColour = (settings: Settings, playAs: Color): Settings => ({
  ...settings,
  playAs,
});

/**
 * Read the stored settings.
 *
 * Storage can be absent, blocked or full of something else entirely, and none
 * of that is worth failing a game over, so anything unexpected falls back to
 * the defaults.
 */
export function loadSettings(storage: Storage = globalThis.localStorage): Settings {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return parseSettings(stored === null ? {} : JSON.parse(stored));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings, storage: Storage = globalThis.localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing, quota, storage disabled: play on regardless.
  }
}
