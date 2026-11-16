// The look plan, in one place: dusk industrial. Ember orange is the accent and the
// attackers' colour; ash blue-grey is the defenders'. Every colour in the game is one
// of these, so the scene reads at a glance. The same names are the CSS custom
// properties in index.html.
export const PALETTE = {
  canvas: '#17130f',
  surface: '#23201c',
  hairline: '#3a332b',
  ink: '#efe7d8',
  muted: '#9a917f',
  accent: '#ff7a1a',
  ember: '#ff7a1a',
  ashen: '#6fa8c9',
  danger: '#e5484d',
  ok: '#7dc383',
};

export function hex(name) {
  return PALETTE[name];
}
