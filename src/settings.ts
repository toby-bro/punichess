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
export type NumericSetting = Exclude<
  keyof Settings,
  'playAs' | 'saveOnNew' | 'pieceSet' | 'boardTheme'
>;

/**
 * The piece sets that ship with the app, in the order they are offered.
 *
 * Bundled rather than fetched: pieces that arrive over the network are pieces
 * that do not arrive on a train, and playing offline is the point. Every one is
 * licensed compatibly with this project -- see README.
 */
export const PIECE_SETS = [
  // Licensed compatibly with this project's own GPL-3.0.
  'merida',
  'cburnett',
  'chessnut',
  'fantasy',
  'celtic',
  'spatial',
  'mpchess',
  'kiwen-suwi',
  // CC BY-NC-SA: free to use here, but they are what makes the bundle as a
  // whole non-commercial. See README.
  'staunty',
  'maestro',
  'gioco',
  'cardinal',
  'fresca',
  'dubrovny',
  'tatiana',
  'california',
] as const;

export type PieceSet = (typeof PIECE_SETS)[number];

/** Board colours, written rather than fetched: a board is two colours. */
export const BOARD_THEMES = ['brown', 'blue', 'green', 'grey', 'purple', 'slate'] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number];

export interface Settings {
  /** The colour you play. The bot takes the other one. */
  readonly playAs: Color;
  /** Which pieces to draw. Yours, on this device.  */
  readonly pieceSet: PieceSet;
  /** Which board to draw them on. */
  readonly boardTheme: BoardTheme;
  /**
   * Save the game in progress when starting a new one.
   *
   * On by default: losing a game to the button next to it is a worse surprise
   * than an unwanted entry in a list you can delete.
   */
  readonly saveOnNew: boolean;
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
  /**
   * The least time the bot will take over a move, in milliseconds.
   *
   * Not thinking time -- the search takes what it takes. This is a floor on how
   * quickly a move comes back, because a bot that answers instantly makes you
   * answer instantly, and playing fast is how you stop looking.
   */
  readonly minMoveMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  playAs: 'white',
  pieceSet: 'staunty',
  boardTheme: 'brown',
  saveOnNew: true,
  targetAcpl: 25,
  quietBand: 100,
  blunderMin: 100,
  blunderMax: 300,
  blunderChance: 0.7,
  blundersPerGame: 8,
  blunderFromPly: 2,
  mateTrapShare: 0.3,
  maxMateDepth: 3,
  ownBlunderCp: 110,
  missedPunishCp: 50,
  minMoveMs: 2000,
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
  minMoveMs: [0, 10_000],
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

  const saveOnNew = source['saveOnNew'];
  result.saveOnNew = typeof saveOnNew === 'boolean' ? saveOnNew : base.saveOnNew;

  // Checked against the list rather than taken on trust: the value ends up in a
  // class name, and a set that was removed since it was chosen must not leave
  // the board with no pieces on it.
  const pieceSet = source['pieceSet'];
  result.pieceSet = PIECE_SETS.find(known => known === pieceSet) ?? base.pieceSet;

  const boardTheme = source['boardTheme'];
  result.boardTheme = BOARD_THEMES.find(known => known === boardTheme) ?? base.boardTheme;

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

/** Choose the pieces. */
export const withPieceSet = (settings: Settings, pieceSet: PieceSet): Settings => ({
  ...settings,
  pieceSet,
});

/** Choose the board. */
export const withBoardTheme = (settings: Settings, boardTheme: BoardTheme): Settings => ({
  ...settings,
  boardTheme,
});

/** Keep, or stop keeping, the game in progress when a new one starts. */
export const withSaveOnNew = (settings: Settings, saveOnNew: boolean): Settings => ({
  ...settings,
  saveOnNew,
});

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
