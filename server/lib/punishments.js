'use strict';

// Reading Phoenix's punishment records.
//
// The one thing you have to know about this collection: a KICK is stored
// `active: true, permanent: true, duration: "-5"` and stays that way forever.
// That is not a bug in the core — a kick happens once and there is nothing to
// expire, so there is no state for it to leave. But it means `active: true` in
// this collection does not mean "this player is restricted right now", and
// anything that counts it as though it did will say a player who was kicked
// twice in March is serving two live punishments.
//
// So the flag is read as the core means it, and the question the website
// actually asks — is this person under a restriction — is answered here.

// The types that put a player in a state. KICK is an event: it is history the
// moment it lands.
const RESTRICTIONS = new Set(['BAN', 'MUTE', 'BLACKLIST']);

function isRestriction(type) {
  return RESTRICTIONS.has(String(type || '').toUpperCase());
}

// Phoenix stores every number in this collection as a string, and permanent
// records carry a nonsense duration ("-5"), so the flag decides before the
// arithmetic — same rule as grants.
function num(v) {
  return Number(v) || 0;
}

function endsAt(doc) {
  if (doc.permanent) return null;
  const d = num(doc.duration);
  if (d <= 0) return null;
  return num(doc.issuedAt) + d;
}

/**
 * Is this punishment restricting the player right now?
 *
 * Every clause matters: `voided` is the core's undo, a lifted punishment has
 * active:false, a timed one can run out on its own, and a kick was never a
 * restriction to begin with.
 */
function isLive(doc, now = Date.now()) {
  if (!doc.active || doc.voided) return false;
  if (!isRestriction(doc.punishmentType)) return false;
  const end = endsAt(doc);
  return end === null || end > now;
}

// The Mongo half of isLive, for counting without pulling the collection into
// memory. It cannot do the expiry arithmetic — that lives in isLive — so it is
// deliberately only used where an over-count of expired-but-not-swept rows is
// acceptable, or paired with a filter.
const LIVE_QUERY = {
  active: true,
  voided: { $ne: true },
  punishmentType: { $in: [...RESTRICTIONS] },
};

/** Counts live restrictions properly, expiry included. */
async function countLive(collection, extra = {}) {
  const docs = await collection.find({ ...LIVE_QUERY, ...extra }).toArray();
  const now = Date.now();
  return docs.filter((d) => isLive(d, now)).length;
}

/**
 * The shape the website shows. `state` is the word a person would use:
 *   live     — restricted right now
 *   expired  — a timed punishment that ran its course
 *   lifted   — a human took it off
 *   served   — a kick; it happened, it is over
 */
function shape(doc, now = Date.now()) {
  const restriction = isRestriction(doc.punishmentType);
  const live = isLive(doc, now);
  const end = endsAt(doc);

  let state;
  if (live) state = 'live';
  else if (!restriction) state = 'served';
  else if (!doc.active || doc.voided) state = 'lifted';
  else state = 'expired';

  return {
    id: doc.punishmentID,
    type: doc.punishmentType,
    reason: doc.reason || null,
    issuedAt: num(doc.issuedAt),
    permanent: !!doc.permanent && restriction,
    duration: restriction && !doc.permanent ? num(doc.duration) : null,
    expiresAt: end,
    state,
    live,
    // Only a live restriction can be appealed. Appealing a kick is appealing
    // something that already finished.
    appealable: live,
    removedReason: doc.removedReason || null,
    removedAt: num(doc.removedAt) || null,
    shadow: !!doc.shadow,
  };
}

module.exports = { RESTRICTIONS, isRestriction, isLive, shape, countLive, endsAt, LIVE_QUERY };
