/**
 * Parsing of UCI engine output.
 *
 * Kept free of any browser API so it can be unit tested under plain Node.
 */

/**
 * Mate scores are folded onto the centipawn scale so that every evaluation is
 * comparable with a single `<`. A faster mate scores higher than a slower one.
 */
export const MATE_CP = 100_000;

/** Score for a forced mate in `moves` for the side to move. */
export const mateToCp = (moves: number): number =>
  Math.sign(moves) * (MATE_CP - Math.abs(moves) * 100);

export interface PvLine {
  /** 1-based rank of this line within the search, 1 being the best. */
  readonly multipv: number;
  /** Score in centipawns, from the perspective of the side to move. */
  readonly cp: number;
  /** Present only for a forced mate; positive means the side to move mates. */
  readonly mate?: number | undefined;
  readonly depth: number;
  /**
   * The principal variation. Typed as non-empty so callers can read the move
   * being scored without a redundant undefined check.
   */
  readonly moves: readonly [string, ...string[]];
}

/**
 * Parse one `info ...` line into a PV.
 *
 * Returns undefined for the many info lines that carry no variation at all
 * (`info depth 1 currmove ...`, `info string ...`), which are simply skipped.
 */
export function parseInfo(line: string): PvLine | undefined {
  const tokens = line.split(' ');
  const after = (key: string): string | undefined => {
    const index = tokens.indexOf(key);
    return index === -1 ? undefined : tokens[index + 1];
  };

  const pvIndex = tokens.indexOf('pv');
  if (pvIndex === -1) return undefined;

  const depth = Number(after('depth'));
  if (!Number.isFinite(depth)) return undefined;

  const scoreIndex = tokens.indexOf('score');
  if (scoreIndex === -1) return undefined;
  const kind = tokens[scoreIndex + 1];
  const value = Number(tokens[scoreIndex + 2]);
  if (!Number.isFinite(value)) return undefined;
  if (kind !== 'cp' && kind !== 'mate') return undefined;

  const [first, ...rest] = tokens.slice(pvIndex + 1).filter(token => token.length > 0);
  if (first === undefined) return undefined;

  const multipv = Number(after('multipv') ?? 1);

  return {
    multipv: Number.isFinite(multipv) ? multipv : 1,
    cp: kind === 'mate' ? mateToCp(value) : value,
    mate: kind === 'mate' ? value : undefined,
    depth,
    moves: [first, ...rest],
  };
}

/**
 * Reduce a search's info lines to one PV per multipv slot, keeping the deepest
 * report for each, ordered best first.
 */
export function collectLines(output: readonly string[]): PvLine[] {
  const deepest = new Map<number, PvLine>();
  for (const line of output) {
    if (!line.startsWith('info ')) continue;
    const pv = parseInfo(line);
    if (!pv) continue;
    const seen = deepest.get(pv.multipv);
    if (!seen || seen.depth <= pv.depth) deepest.set(pv.multipv, pv);
  }
  return [...deepest.values()].sort((a, b) => a.multipv - b.multipv);
}
