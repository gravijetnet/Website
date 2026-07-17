'use strict';

const mongo = require('./mongo');

// Who did what, on the website's side of the network.
//
// Lives in its own file because more than one router writes to it now, and two
// copies of "record this" is how one of them quietly stops recording.
//
// This is the answer to "da soll dann auch stehen wer das war": a punishment
// issued from Spielplatz carries the moderator's Discord identity here, where
// staff can read it, and nowhere the punished player can see. Phoenix's own
// `issuedBy` is a Minecraft UUID and is only as good as whether that moderator
// has linked an account — this is not, and it is always written.

function actor(req) {
  return {
    id: req.session.discord.id,
    name: req.session.discord.globalName || req.session.discord.username,
    ranks: req.staff.ranks,
  };
}

async function record(req, action, subject, extra = {}) {
  try {
    await (await mongo.site.audit()).insertOne({
      at: Date.now(),
      action,
      subject,
      by: actor(req),
      ...extra,
    });
  } catch (err) {
    // An unwritten audit line must not silently accompany a completed action.
    console.error('[audit] FAILED to record', action, subject, err.message);
  }
}

module.exports = { record, actor };
