'use strict';

// Minecraft legacy colour codes -> hex. Ranks are stored like "&4Owner" and
// division display names like "§7Silver I", so we normalise both & and §.
const CODES = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF',
  c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

// Formatting codes we strip but do not colour.
const FORMAT = new Set(['k', 'l', 'm', 'n', 'o', 'r']);

// Strip every colour/format code from a string.
function strip(str) {
  if (str == null) return '';
  return String(str).replace(/[&§][0-9a-fk-or]/gi, '').trim();
}

// Parse a coloured label into { label, color }. Uses the first colour code as
// the representative colour of the rank/division; falls back to a neutral grey.
function parse(str) {
  if (str == null) return { label: '', color: '#AAAAAA' };
  const s = String(str);
  let color = null;
  const re = /[&§]([0-9a-fk-or])/gi;
  let m;
  while ((m = re.exec(s))) {
    const code = m[1].toLowerCase();
    if (CODES[code] && color === null) color = CODES[code];
  }
  return { label: strip(s), color: color || '#AAAAAA' };
}

module.exports = { strip, parse, CODES, FORMAT };
