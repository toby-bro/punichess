/**
 * The title's face, drawn fresh on every load.
 *
 * One hundred and seventeen cartoon faces and no reason to prefer any of them,
 * so the page picks one each time it opens. It costs one stylesheet for one
 * family -- the other hundred and sixteen are never requested -- and it is the
 * only thing in the app that comes over the network. Offline the request fails,
 * the fallback stack takes over, and the game does not notice.
 *
 * Every family is on Google Fonts under the SIL Open Font License.
 */

/** What to fall back to: the font is decoration, and it may simply not arrive. */
const FALLBACK = 'system-ui, -apple-system, sans-serif';

export const BRAND_FONTS: readonly string[] = [
  // Comic book lettering -- The closest thing to what the category means: heavy, inked, shouting.
  'Bangers',
  'Luckiest Guy',
  'Permanent Marker',
  'Bowlby One',
  'Bowlby One SC',
  'Titan One',
  'Sigmar',
  'Sigmar One',
  'Chango',
  'Rammetto One',
  'Lilita One',
  'Knewave',
  'Fugaz One',
  'Passion One',
  'Ultra',
  'Racing Sans One',

  // Fat and bubbly -- Round, swollen, sticker-like.
  'Bagel Fat One',
  'Cherry Bomb One',
  'Caprasimo',
  'Modak',
  'Rubik Bubbles',
  'Baloo Bhaijaan 2',
  'Sour Gummy',
  'Bubblegum Sans',
  'Chicle',
  'Shrikhand',
  'Lemonada',
  'Gorditas',
  'Wendy One',
  'Spicy Rice',
  'Erica One',

  // Playful and rounded -- Softer. Friendly rather than loud.
  'Fredoka',
  'Baloo 2',
  'Sniglet',
  'Gluten',
  'Grandstander',
  'Chewy',
  'Boogaloo',
  'Concert One',
  'Jua',
  'Comic Neue',
  'Comic Relief',
  'Itim',
  'Pangolin',
  'Mali',
  'Averia Libre',

  // Slab and sign-painter -- Cartoon by way of a fairground poster.
  'Bungee',
  'Bungee Inline',
  'Bungee Shade',
  'Bungee Outline',
  'Bungee Spice',
  'Rowdies',
  'Righteous',
  'Skranji',
  'Ranchers',
  'Salsa',
  'Slackey',
  'Frijole',
  'Chelsea Market',
  'Life Savers',
  'Fontdiner Swanky',
  'Sancreek',
  'Rye',
  'Poller One',
  'Marko One',
  'Piedra',
  'Ribeye',

  // Hand drawn -- Marker and pencil.
  'Patrick Hand',
  'Kalam',
  'Schoolbell',
  'Gaegu',
  'Shantell Sans',
  'Lemon',
  'Gochi Hand',
  'Just Another Hand',
  'Coming Soon',
  'Indie Flower',
  'Amatic SC',
  'Nerko One',
  'Crafty Girls',
  'Love Ya Like A Sister',
  'Neucha',
  'Short Stack',
  'Unkempt',
  'Emilys Candy',
  'Sofadi One',
  'Delius Swash Caps',
  'Sriracha',

  // Monster and mischief -- For when punishing you is the whole point.
  'Creepster',
  'Eater',
  'Nosifer',
  'Butcherman',
  'Freckle Face',
  'Kranky',
  'Mystery Quest',
  'Flavors',
  'Rubik Beastly',
  'Rubik Glitch',
  'Rubik Marker Hatch',
  'Rubik Wet Paint',
  'Rubik Spray Paint',
  'Rubik Vinyl',
  'Rubik Moonrocks',
  'Rubik Doodle Shadow',
  'Rubik Puddles',
  'Rubik Iso',
  'Fascinate Inline',
  'Tilt Warp',

  // Show-offs -- Colour and depth built into the font itself.
  'Honk',
  'Nabla',
  'Kablammo',
  'Foldit',
  'Danfo',
  'Mochiy Pop One',
  'Potta One',
  'Reggae One',
  'Dela Gothic One',
];

/** Today's face. `random` is injected so a test can pin it. */
export const pickBrandFont = (random: () => number = Math.random): string =>
  BRAND_FONTS[Math.floor(random() * BRAND_FONTS.length)] ?? 'Fredoka';

/**
 * The line hiding in the title's tooltip.
 *
 * Stolen wholesale from xkcd, where every comic has a second joke in the
 * `title` attribute that you only find by leaving the pointer still. Nothing
 * here is load-bearing; it is the one place in the app allowed to be rude.
 */
export const HOVER_LINES: readonly string[] = [
  'Because you suck at chess.',
  'It is not that the bot is good. It is that you keep doing that.',
  'Every red arrow on this board is a receipt.',
  'The bot blundered eleven moves ago and you said nothing.',
  'Statistically, you are about to hang that knight.',
  'The engine is not judging you. The engine is judging you.',
  'You had mate in two. You now have mate in never.',
  'Punish, from the Latin for "we did tell you".',
  'No opening theory, no endgame technique. Vibes and regret.',
  'It gave you a rook. You gave it back. Twice.',
  'Offline, so nobody else has to see this.',
  'The bot is playing badly on purpose. You are freelancing.',
  'Written entirely to avoid learning any openings.',
  'Somewhere, a 1200 is disappointed in you.',
  'All your mistakes, remembered forever, on this device only.',
  'The only part of this app that will not interrupt you mid-move.',
];

/** One of them, at random. */
export const pickHoverLine = (random: () => number = Math.random): string =>
  HOVER_LINES[Math.floor(random() * HOVER_LINES.length)] ?? HOVER_LINES[0] ?? '';

/** Where Google Fonts serves one family from. */
export const brandFontUrl = (name: string): string =>
  `https://fonts.googleapis.com/css2?family=${name.replaceAll(' ', '+')}&display=swap`;

/** The value `--brand-font` takes, fallback included. */
export const brandFontStack = (name: string): string => `'${name}', ${FALLBACK}`;

/**
 * Dress the title: a face, a note of which face, and something to find on hover.
 *
 * Which face came up is recorded as an HTML comment beside the title -- in the
 * markup, never on the page. The point of rolling a new one every load is that
 * sooner or later one is worth keeping, and you cannot ask for one you have no
 * name for; but a line of small print under the title every single time is a
 * high price for a question asked twice. View source when you want to know.
 *
 * Which leaves the tooltip free for what xkcd uses it for.
 */
export function dressBrand(doc: Document = document, random: () => number = Math.random): void {
  const name = pickBrandFont(random);

  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = brandFontUrl(name);
  doc.head.appendChild(link);
  doc.documentElement.style.setProperty('--brand-font', brandFontStack(name));

  const brand = doc.querySelector('.brand');
  if (!brand) return;
  brand.setAttribute('title', pickHoverLine(random));
  brand.after(doc.createComment(` font: ${name} `));
}
