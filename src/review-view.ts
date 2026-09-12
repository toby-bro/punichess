/**
 * The post-game review: an evaluation graph and every move with the
 * alternatives that were available.
 *
 * The graph and the move list are two views of the same thing, so selecting in
 * either drives the other and the board.
 */

import type { Color } from 'chessops/types';

import { areaPath, chartPoints, linePath } from './chart.ts';
import type { Review, ReviewedMove } from './review.ts';
import { scrollWithin } from './scroll.ts';
import type { Judgement, Summary } from './stats.ts';
import { MATE_CP } from './uci.ts';

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 600;
const HEIGHT = 140;

/** Labels worth calling out in the graph and the list. */
const NOTABLE: readonly Judgement[] = ['inaccuracy', 'mistake', 'blunder'];

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG, name);

/** Render an evaluation the way a player reads it. */
export function formatEval(cp: number, mate?: number): string {
  if (mate !== undefined) return `#${mate > 0 ? '' : '-'}${Math.abs(mate)}`;
  if (Math.abs(cp) > MATE_CP - 10_000) return cp > 0 ? '#' : '-#';
  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}

export interface ReviewOptions {
  readonly you: Color;
  /** The node id of the starting position, for selecting the left edge. */
  readonly rootId: number;
  readonly onSelect: (nodeId: number) => void;
  /**
   * Accuracy counting every move submitted, retries included. Shown alongside
   * the figure for the final line, which quietly forgets what was taken back.
   */
  readonly attempts?: { readonly you: Summary; readonly bot: Summary } | undefined;
}

export interface ReviewView {
  /** Follow the board: mark the position now being looked at. */
  setSelected(nodeId: number): void;
}

export function renderReview(
  root: HTMLElement,
  review: Review,
  options: ReviewOptions,
): ReviewView {
  root.replaceChildren();

  const graph = chart(review, options);
  const rows = new Map<number, HTMLElement>();
  const list = document.createElement('div');
  list.className = 'review-moves';
  for (const move of review.moves) {
    const row = moveRow(move, options.onSelect);
    rows.set(move.nodeId, row);
    list.append(row);
  }

  root.append(summaryTable(review, options), graph.element, list);

  return {
    setSelected(nodeId) {
      for (const [id, row] of rows) row.classList.toggle('selected', id === nodeId);
      const index =
        nodeId === options.rootId ? 0 : review.moves.findIndex(move => move.nodeId === nodeId) + 1;
      graph.mark(index > 0 || nodeId === options.rootId ? index : undefined);
      const row = rows.get(nodeId);
      if (row) scrollWithin(list, row);
    },
  };
}

function summaryTable(review: Review, options: ReviewOptions): HTMLElement {
  const table = document.createElement('table');
  table.className = 'summary';

  // Your column comes first whichever colour you took.
  const yoursIsWhite = options.you === 'white';
  const columns: [string, Summary, Summary | undefined][] = yoursIsWhite
    ? [
        ['You (White)', review.white, options.attempts?.you],
        ['Bot (Black)', review.black, options.attempts?.bot],
      ]
    : [
        ['You (Black)', review.black, options.attempts?.you],
        ['Bot (White)', review.white, options.attempts?.bot],
      ];

  const header = document.createElement('tr');
  for (const text of ['', ...columns.map(([label]) => label)]) {
    const cell = document.createElement('th');
    cell.textContent = text;
    header.append(cell);
  }
  table.append(header);

  const rows: [string, (line: Summary, attempts: Summary | undefined) => string][] = [
    ['Average loss (final line)', line => `${line.acpl} cp`],
    [
      'Average loss (every attempt)',
      (_line, attempts) => (attempts && attempts.moves > 0 ? `${attempts.acpl} cp` : '—'),
    ],
    ['Best moves', line => String(line.best)],
    ['Inaccuracies', line => String(line.inaccuracy)],
    ['Mistakes', line => String(line.mistake)],
    ['Blunders', line => String(line.blunder)],
  ];

  for (const [label, read] of rows) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.textContent = label;
    row.append(name);
    for (const [, line, attempts] of columns) {
      const cell = document.createElement('td');
      cell.textContent = read(line, attempts);
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

interface Chart {
  readonly element: SVGSVGElement;
  /** Draw the position marker, or clear it when nothing is selected. */
  mark(index: number | undefined): void;
}

function chart(review: Review, options: ReviewOptions): Chart {
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('class', 'eval-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Evaluation through the game');

  const points = chartPoints(review.evals, WIDTH, HEIGHT);

  const middle = svgEl('line');
  middle.setAttribute('x1', '0');
  middle.setAttribute('x2', String(WIDTH));
  middle.setAttribute('y1', String(HEIGHT / 2));
  middle.setAttribute('y2', String(HEIGHT / 2));
  middle.setAttribute('class', 'eval-axis');

  const area = svgEl('path');
  area.setAttribute('d', areaPath(points, HEIGHT));
  area.setAttribute('class', 'eval-area');

  const line = svgEl('path');
  line.setAttribute('d', linePath(points));
  line.setAttribute('class', 'eval-line');

  const cursor = svgEl('line');
  cursor.setAttribute('y1', '0');
  cursor.setAttribute('y2', String(HEIGHT));
  cursor.setAttribute('class', 'eval-cursor');
  cursor.setAttribute('visibility', 'hidden');

  svg.append(area, middle, line, cursor);

  // A dot on every move worth a second look.
  for (const move of review.moves) {
    if (!NOTABLE.includes(move.judgement)) continue;
    const point = points[move.ply];
    if (!point) continue;
    const dot = svgEl('circle');
    dot.setAttribute('cx', String(point.x));
    dot.setAttribute('cy', String(point.y));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', `eval-mark ${move.judgement}`);
    const title = svgEl('title');
    title.textContent = `${move.san} — ${move.judgement}`;
    dot.append(title);
    svg.append(dot);
  }

  // Anywhere on the graph selects the nearest position, which is far easier to
  // hit with a thumb than a four-pixel dot.
  const surface = svgEl('rect');
  surface.setAttribute('x', '0');
  surface.setAttribute('y', '0');
  surface.setAttribute('width', String(WIDTH));
  surface.setAttribute('height', String(HEIGHT));
  surface.setAttribute('class', 'eval-surface');
  surface.addEventListener('click', event => {
    const box = svg.getBoundingClientRect();
    if (box.width === 0 || review.evals.length === 0) return;
    const fraction = (event.clientX - box.left) / box.width;
    const index = Math.round(fraction * (review.evals.length - 1));
    const clamped = Math.max(0, Math.min(index, review.evals.length - 1));
    options.onSelect(
      clamped === 0 ? options.rootId : (review.moves[clamped - 1]?.nodeId ?? options.rootId),
    );
  });
  svg.append(surface);

  return {
    element: svg,
    mark(index) {
      const point = index === undefined ? undefined : points[index];
      if (!point) {
        cursor.setAttribute('visibility', 'hidden');
        return;
      }
      cursor.setAttribute('x1', String(point.x));
      cursor.setAttribute('x2', String(point.x));
      cursor.setAttribute('visibility', 'visible');
    },
  };
}

function moveRow(move: ReviewedMove, onSelect: (nodeId: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = `review-move ${move.judgement}`;
  row.onclick = () => {
    onSelect(move.nodeId);
  };

  const heading = document.createElement('div');
  heading.className = 'review-head';

  const number = document.createElement('span');
  number.className = 'review-number';
  number.textContent = `${Math.ceil(move.ply / 2)}${move.by === 'white' ? '.' : '…'}`;

  const san = document.createElement('strong');
  san.textContent = move.san;

  const judgement = document.createElement('span');
  judgement.className = 'review-judgement';
  judgement.textContent = NOTABLE.includes(move.judgement)
    ? `${move.judgement} (−${(move.cpLoss / 100).toFixed(2)})`
    : formatEval(move.evalAfter);

  heading.append(number, san, judgement);
  row.append(heading);

  // The alternatives are the point of the exercise: what was there instead.
  const alternatives = document.createElement('ol');
  alternatives.className = 'alternatives';
  for (const alternative of move.alternatives) {
    const item = document.createElement('li');
    if (alternative.played) item.classList.add('played');
    item.textContent = `${alternative.san} ${formatEval(alternative.cp, alternative.mate)}`;
    alternatives.append(item);
  }
  row.append(alternatives);
  return row;
}
