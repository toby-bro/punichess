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

/** Where Google Fonts serves one family from. */
export const brandFontUrl = (name: string): string =>
  `https://fonts.googleapis.com/css2?family=${name.replaceAll(' ', '+')}&display=swap`;

/** The value `--brand-font` takes, fallback included. */
export const brandFontStack = (name: string): string => `'${name}', ${FALLBACK}`;

/**
 * Ask for the font and hand it to the stylesheet.
 *
 * The name is put on the title's tooltip as well, because the whole point of
 * rolling a different one every time is that sooner or later one of them is
 * worth keeping, and there has to be some way of finding out which it was.
 */
export function applyBrandFont(name: string, doc: Document = document): void {
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = brandFontUrl(name);
  doc.head.appendChild(link);
  doc.documentElement.style.setProperty('--brand-font', brandFontStack(name));
  const brand = doc.querySelector('.brand');
  if (brand) brand.setAttribute('title', name);
}
