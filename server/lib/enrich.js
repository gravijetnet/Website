'use strict';

const players = require('./players');

// Attach registry identity (rank colour, online state, canonical name) to a
// list of mode stat rows keyed by `uuid`. Rows keep their own `name` as a
// fallback for players not present in the phoenixbridge registry.
async function withIdentity(rows) {
  const map = await players.identityMap(rows.map((r) => r.uuid));
  return rows.map((row, i) => {
    const id = map.get(row.uuid);
    return {
      rank: i + 1,
      uuid: row.uuid,
      name: id?.name || row.name || 'Unknown',
      identity: id
        ? { rank: id.rank, online: id.online }
        : { rank: { label: 'Member', color: '#AAAAAA' }, online: false },
      stats: row,
    };
  });
}

module.exports = { withIdentity };
