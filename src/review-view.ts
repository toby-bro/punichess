/**
 * The post-game review: an evaluation graph and every move with the
 * alternatives that were available.
 */

import type { Color } from 'chessops/types';

import { areaPath, chartPoints, linePath } from './chart.ts';
import type { Review, ReviewedMove } from './review.ts';
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

export function renderReview(
  root: HTMLElement,
  review: Review,
  you: Color,
  onSelect: (ply: number) => void,
): void {
  root.replaceChildren();
  root.append(summaryTable(review, you), chart(review, onSelect), moveList(review, onSelect));
}

function summaryTable(review: Review, you: Color): HTMLElement {
  const table = document.createElement('table');
  table.className = 'summary';

  // Your column comes first whichever colour you took.
  const columns: [string, Summary][] =
    you === 'white'
      ? [
          ['You (White)', review.white],
          ['Bot (Black)', review.black],
        ]
      : [
          ['You (Black)', review.black],
          ['Bot (White)', review.white],
        ];

  const header = document.createElement('tr');
  for (const text of ['', ...columns.map(([label]) => label)]) {
    const cell = document.createElement('th');
    cell.textContent = text;
    header.append(cell);
  }
  table.append(header);

  const rows: [string, (s: Summary) => string][] = [
    ['Average loss', s => `${s.acpl} cp`],
    ['Best moves', s => String(s.best)],
    ['Inaccuracies', s => String(s.inaccuracy)],
    ['Mistakes', s => String(s.mistake)],
    ['Blunders', s => String(s.blunder)],
  ];
  for (const [label, read] of rows) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.textContent = label;
    row.append(name);
    for (const [, summary] of columns) {
      const cell = document.createElement('td');
      cell.textContent = read(summary);
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

function chart(review: Review, onSelect: (ply: number) => void): SVGSVGElement {
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

  svg.append(area, middle, line);

  // A dot on every move worth a second look, clickable like the list.
  for (const move of review.moves) {
    if (!NOTABLE.includes(move.judgement)) continue;
    const point = points[move.ply];
    if (!point) continue;
    const dot = svgEl('circle');
    dot.setAttribute('cx', String(point.x));
    dot.setAttribute('cy', String(point.y));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', `eval-mark ${move.judgement}`);
    dot.addEventListener('click', () => {
      onSelect(move.ply);
    });
    const title = svgEl('title');
    title.textContent = `${move.san} — ${move.judgement}`;
    dot.append(title);
    svg.append(dot);
  }

  return svg;
}

function moveList(review: Review, onSelect: (ply: number) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'review-moves';
  for (const move of review.moves) {
    list.append(moveRow(move, onSelect));
  }
  return list;
}

function moveRow(move: ReviewedMove, onSelect: (ply: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = `review-move ${move.judgement}`;
  row.onclick = () => {
    onSelect(move.ply);
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
