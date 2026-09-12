/**
 * The settings form.
 *
 * Kept apart from the game loop: it knows how to show a `Settings` and how to
 * report an edited one, and nothing about chess.
 */

import { type NumericSetting, PRESETS, type Settings, withSetting } from './settings.ts';

interface Field {
  readonly key: NumericSetting;
  readonly label: string;
  readonly help: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
}

const pawns = (cp: number): string => `${(cp / 100).toFixed(2)} pawns`;
const percent = (share: number): string => `${Math.round(share * 100)}%`;

const FIELDS: readonly Field[] = [
  {
    key: 'targetAcpl',
    label: 'Bot average loss',
    help: 'How much the bot throws away per move on average. The strength dial.',
    min: 0,
    max: 120,
    step: 5,
    format: cp => `${cp} cp`,
  },
  {
    key: 'minMoveMs',
    label: 'Bot takes at least',
    help: 'A floor on how fast a move comes back. Answering instantly makes you answer instantly.',
    min: 0,
    max: 10_000,
    step: 250,
    format: ms => (ms === 0 ? 'no wait' : `${(ms / 1000).toFixed(2)}s`),
  },
  {
    key: 'quietBand',
    label: 'Bot worst ordinary move',
    help: 'No honest move costs more than this, whatever the average.',
    min: 20,
    max: 300,
    step: 10,
    format: pawns,
  },
  {
    key: 'blunderChance',
    label: 'Chance of a deliberate error',
    help: 'Per eligible move.',
    min: 0,
    max: 1,
    step: 0.05,
    format: percent,
  },
  {
    key: 'blundersPerGame',
    label: 'Deliberate errors per game',
    help: 'At most.',
    min: 0,
    max: 12,
    step: 1,
    format: String,
  },
  {
    key: 'mateTrapShare',
    label: 'Errors that allow mate',
    help: 'Share of deliberate errors that hand you a forced mate instead of material.',
    min: 0,
    max: 1,
    step: 0.1,
    format: percent,
  },
  {
    key: 'maxMateDepth',
    label: 'Longest mate offered',
    help: 'A mate in 1 is a gift; a mate in 3 is a puzzle.',
    min: 1,
    max: 5,
    step: 1,
    format: n => `mate in ${n}`,
  },
  {
    key: 'blunderMin',
    label: 'Deliberate error, smallest',
    help: 'An error has to cost at least this to be worth spotting.',
    min: 30,
    max: 600,
    step: 10,
    format: pawns,
  },
  {
    key: 'blunderMax',
    label: 'Deliberate error, largest',
    help: 'And at most this, so the game stays a game.',
    min: 50,
    max: 1200,
    step: 25,
    format: pawns,
  },
  {
    key: 'ownBlunderCp',
    label: 'Stop me when I lose',
    help: 'How bad one of your moves has to be before the game interrupts you.',
    min: 20,
    max: 400,
    step: 10,
    format: pawns,
  },
  {
    key: 'missedPunishCp',
    label: 'Stop me when I miss a gift',
    help: 'The stricter bar, applied only to your reply to a deliberate error.',
    min: 10,
    max: 300,
    step: 10,
    format: pawns,
  },
];

export interface SettingsPanel {
  /** Redraw the values, after a preset or a load. */
  update(settings: Settings): void;
}

export function mountSettings(
  root: HTMLElement,
  initial: Settings,
  onChange: (settings: Settings) => void,
): SettingsPanel {
  root.replaceChildren();
  let current = initial;

  const readouts = new Map<NumericSetting, HTMLElement>();
  const inputs = new Map<NumericSetting, HTMLInputElement>();

  /** Redraw every field: clamping one value can move a neighbour too. */
  function update(settings: Settings): void {
    current = settings;
    for (const field of FIELDS) {
      readouts.get(field.key)?.replaceChildren(field.format(settings[field.key]));
      const input = inputs.get(field.key);
      if (input) input.value = String(settings[field.key]);
    }
  }

  const presets = document.createElement('div');
  presets.className = 'presets';
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.title = preset.description;
    button.onclick = () => {
      current = { ...current, ...preset.settings };
      update(current);
      onChange(current);
    };
    presets.append(button);
  }
  root.append(presets);

  for (const field of FIELDS) {
    const row = document.createElement('label');
    row.className = 'field';
    row.title = field.help;

    const name = document.createElement('span');
    name.className = 'field-label';
    name.textContent = field.label;

    const value = document.createElement('span');
    value.className = 'field-value';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = String(field.step);
    input.oninput = () => {
      current = withSetting(current, field.key, Number(input.value));
      update(current);
      onChange(current);
    };

    row.append(name, value, input);
    root.append(row);
    readouts.set(field.key, value);
    inputs.set(field.key, input);
  }

  update(initial);
  return { update };
}
