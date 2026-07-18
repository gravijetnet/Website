'use strict';

const mongo = require('./mongo');
const rules = require('./rules');

// Point-in-time copies of the network configuration.
//
// The network editor changes ranks, ladders, the report menu and the rules in
// place and in game; a snapshot is the undo. A backup captures the current state
// of all four into our own database, where it can be listed, downloaded, or
// re-applied. It is a copy, not a lock: taking one changes nothing.

// A stable-ish id without Date.now (the workflow rule against it does not apply
// here, but a readable id helps). Uses the timestamp we already record.
function backupId(at) {
  return `bk_${at}`;
}

// Everything worth keeping, read straight from where each lives.
async function capture() {
  const [rankDocs, ladderDocs, categoryDocs, ruleData] = await Promise.all([
    (await mongo.phoenix.ranks()).find({}).toArray(),
    (await mongo.phoenix.punishmentLadders()).find({}).toArray(),
    (await mongo.phoenix.reportCategories()).find({}).toArray(),
    rules.load().catch(() => null),
  ]);
  return {
    ranks: rankDocs,
    ladders: ladderDocs,
    categories: categoryDocs,
    rules: ruleData ? ruleData.sections : null,
  };
}

async function create(by, note) {
  const at = Date.now();
  const data = await capture();
  const doc = {
    _id: backupId(at),
    at,
    by,
    note: note || null,
    counts: {
      ranks: data.ranks.length,
      ladders: data.ladders.length,
      categories: data.categories.length,
      rules: data.rules ? data.rules.length : 0,
    },
    data,
  };
  await (await mongo.site.backups()).insertOne(doc);
  return doc;
}

// The list is metadata only — the captured config can be large, and nobody
// scrolling a list of backups needs every rank's permissions inlined.
async function list() {
  const rows = await (await mongo.site.backups())
    .find({}, { projection: { data: 0 } })
    .sort({ at: -1 })
    .limit(50)
    .toArray();
  return rows;
}

async function get(id) {
  return (await mongo.site.backups()).findOne({ _id: id });
}

async function remove(id) {
  const r = await (await mongo.site.backups()).deleteOne({ _id: id });
  return r.deletedCount > 0;
}

module.exports = { create, list, get, remove };
