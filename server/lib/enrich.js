'use strict';

const players = require('./players');
const hidden = require('./hidden');

// Attach registry identity (rank colour, online state, canonical name) to a
// list of mode stat rows keyed by `uuid`. Rows keep their own `name` as a
// fallback for players not present in the phoenixbridge registry.
//
// Rows arrive already sorted by the ladder's metric, so a name that appears
// twice — a premium account and its offline counterpart, see players.isPremium —
// keeps its better placing and loses the other. Ranks are numbered after that,
// so the board never shows a name twice and never skips a number doing it.
async function withIdentity(rows) {
  const [map, hiddenSet] = await Promise.all([
    players.identityMap(rows.map((r) => r.uuid)),
    hidden.uuids(),
  ]);

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (hiddenSet.has(row.uuid)) continue;
    const id = map.get(row.uuid);
    const name = id?.name || row.name || 'Unknown';
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rank: out.length + 1,
      uuid: row.uuid,
      name,
      identity: id
        ? { rank: id.rank, online: id.online }
        : { rank: { label: 'Member', color: '#AAAAAA' }, online: false },
      stats: row,
    });
  }
  return out;
}

module.exports = { withIdentity };
