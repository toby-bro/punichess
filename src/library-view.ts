/**
 * The list of saved games.
 *
 * Each row says what the game was and how it went, because a list of dates is
 * no help in finding the game where you kept missing the same thing.
 */

import type { GameLibrary, SavedGame } from './library.ts';

export interface LibraryActions {
  readonly onLoad: (id: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onFavourite: (id: string, favourite: boolean) => void;
}

export interface LibraryView {
  render(): void;
}

const when = (stamp: number): string =>
  stamp === 0
    ? 'unknown date'
    : new Date(stamp).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

/** The line under the name: how the game actually went. */
function summarise(game: SavedGame): string {
  const { metrics } = game;
  return [
    `${metrics.moves} moves`,
    `you ${metrics.youAcpl} cp`,
    `bot ${metrics.botAcpl} cp`,
    `spotted ${metrics.spotted}`,
    `missed ${metrics.missed}`,
    `made ${metrics.made}`,
  ].join(' · ');
}

export function mountLibrary(
  root: HTMLElement,
  library: GameLibrary,
  actions: LibraryActions,
): LibraryView {
  const view: LibraryView = {
    render() {
      root.replaceChildren();
      if (library.size === 0) {
        const empty = document.createElement('p');
        empty.className = 'pgn-status';
        empty.textContent = 'Nothing saved yet.';
        root.append(empty);
        return;
      }
      for (const game of library.games) root.append(row(game, actions));
    },
  };
  view.render();
  return view;
}

function row(game: SavedGame, actions: LibraryActions): HTMLElement {
  const item = document.createElement('div');
  item.className = 'saved-game';

  const heading = document.createElement('div');
  heading.className = 'saved-heading';

  // A star rather than a switch: it marks a thing rather than turning one on.
  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'star';
  const favourite = game.favourite === true;
  star.textContent = favourite ? '★' : '☆';
  star.setAttribute('aria-pressed', String(favourite));
  star.title = favourite ? 'Kept back from any purge' : 'Keep this one';
  star.onclick = () => {
    actions.onFavourite(game.id, !favourite);
  };

  const name = document.createElement('input');
  name.className = 'saved-name';
  name.value = game.name;
  name.spellcheck = false;
  name.setAttribute('aria-label', 'Game name');
  // Renaming where the name already is, rather than behind a dialog.
  const commit = (): void => {
    if (name.value.trim() !== game.name) actions.onRename(game.id, name.value);
  };
  name.onblur = commit;
  name.onkeydown = event => {
    if (event.key === 'Enter') name.blur();
  };

  const meta = document.createElement('div');
  meta.className = 'saved-meta';
  meta.textContent = `${when(game.saved)} · as ${game.playedAs} · ${summarise(game)}`;

  const controls = document.createElement('div');
  controls.className = 'saved-controls';

  const load = document.createElement('button');
  load.type = 'button';
  load.textContent = 'Open';
  load.onclick = () => {
    actions.onLoad(game.id);
  };

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.onclick = () => {
    actions.onDelete(game.id);
  };

  controls.append(load, remove);
  heading.append(star, name);
  item.append(heading, meta, controls);
  return item;
}
