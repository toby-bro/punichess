/**
 * How the board looks: the pieces and the colours.
 *
 * Its own panel rather than a corner of the bot settings. How the bot plays and
 * how the board looks are different questions, and the second one was
 * impossible to find filed under the first.
 */

import {
  BOARD_THEMES,
  type BoardTheme,
  PIECE_SETS,
  type PieceSet,
  type Settings,
  withBoardTheme,
  withPieceSet,
} from './settings.ts';

export interface AppearancePanel {
  update(settings: Settings): void;
}

export function mountAppearance(
  root: HTMLElement,
  initial: Settings,
  onChange: (settings: Settings) => void,
): AppearancePanel {
  root.replaceChildren();
  let current = initial;

  const pieceButtons = new Map<PieceSet, HTMLButtonElement>();
  const boardButtons = new Map<BoardTheme, HTMLButtonElement>();

  function update(settings: Settings): void {
    current = settings;
    for (const [set, button] of pieceButtons) {
      button.setAttribute('aria-pressed', String(set === settings.pieceSet));
    }
    for (const [theme, button] of boardButtons) {
      button.setAttribute('aria-pressed', String(theme === settings.boardTheme));
      // The swatch shows the pieces you have actually chosen, so the two
      // choices can be judged together rather than one at a time.
      button.className = `board-swatch cg-wrap board-${theme} set-${settings.pieceSet}`;
    }
  }

  const label = (text: string): HTMLElement => {
    const heading = document.createElement('p');
    heading.className = 'appearance-label';
    heading.textContent = text;
    return heading;
  };

  // Pieces, shown as pieces: "mpchess" and "kiwen-suwi" describe nothing, and a
  // king and a knight describe everything.
  root.append(label('Pieces'));
  const pieces = document.createElement('div');
  pieces.className = 'swatches';
  for (const set of PIECE_SETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `piece-swatch cg-wrap set-${set}`;
    button.title = set;
    button.setAttribute('aria-label', `${set} pieces`);
    for (const role of ['king', 'knight']) {
      const piece = document.createElement('piece');
      piece.className = `${role} white`;
      button.append(piece);
    }
    button.onclick = () => {
      current = withPieceSet(current, set);
      update(current);
      onChange(current);
    };
    pieceButtons.set(set, button);
    pieces.append(button);
  }
  root.append(pieces);

  root.append(label('Board'));
  const boards = document.createElement('div');
  boards.className = 'swatches';
  for (const theme of BOARD_THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = theme;
    button.setAttribute('aria-label', `${theme} board`);
    // A real board, four squares of it, with a real piece standing on it.
    const board = document.createElement('cg-board');
    const piece = document.createElement('piece');
    piece.className = 'king white';
    board.append(piece);
    button.append(board);
    button.onclick = () => {
      current = withBoardTheme(current, theme);
      update(current);
      onChange(current);
    };
    boardButtons.set(theme, button);
    boards.append(button);
  }
  root.append(boards);

  update(initial);
  return { update };
}
