'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const router = express.Router();

const mongo = require('../lib/mongo');
const staff = require('../lib/staff');

// Screenshots attached to an application.
//
// A builder application asks somebody to show their work, and until now the only
// answer it would take was a link — which means an imgur account, or a Discord
// message they have to go and find the URL of, in order to show us a screenshot
// they already have on their desk. That is a real reason not to bother applying.
//
// No multipart parser and no new dependency: the browser sends one file as the
// raw request body with its type in the header, which is less code than parsing
// a multipart envelope and a much smaller thing to get wrong. express.raw does
// the whole job.

const DIR = process.env.UPLOAD_DIR || '/var/lib/gravijet-uploads';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PER_APPLICATION = 6;

// Content-Type is whatever the client felt like saying, so it decides nothing.
// The first bytes of the file decide, and a file whose bytes are not on this
// list does not get written. Images only: this is "show us your build", not a
// general file host, and the moment it accepts arbitrary bytes it is one.
const MAGIC = [
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  return MAGIC.find((m) => m.test(buf)) || null;
}

const raw = express.raw({ type: () => true, limit: MAX_BYTES });

router.post('/uploads', raw, async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });

  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'empty' });

  const kind = sniff(buf);
  if (!kind) return res.status(415).json({ error: 'not_an_image' });

  try {
    // Content-addressed: the same screenshot sent twice is one file on disk, and
    // the id cannot be guessed into somebody else's upload because the row, not
    // the path, decides who may read it.
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const id = `${sha.slice(0, 32)}.${kind.ext}`;

    await fs.mkdir(DIR, { recursive: true });
    // Written even if a row for it exists: a half-deleted disk should heal
    // rather than serve a 404 for a file we have.
    await fs.writeFile(path.join(DIR, id), buf);

    await (await mongo.site.uploads()).updateOne(
      { _id: id },
      {
        $set: { _id: id, mime: kind.mime, bytes: buf.length },
        // The uploader is recorded once, on first sight. If two people upload
        // the same image, it stays attributed to whoever got there first — and
        // both can still read it, because both attached it to their own
        // application and that is what the read check actually asks about.
        $setOnInsert: {
          discordId: req.session.discord.id,
          name: String(req.query.name || 'screenshot').slice(0, 120),
          at: Date.now(),
        },
      },
      { upsert: true },
    );

    res.status(201).json({ id, bytes: buf.length, mime: kind.mime });
  } catch (err) {
    console.error('[upload]', err);
    res.status(500).json({ error: 'upload_failed' });
  }
});

// Reading one back.
//
// Not a static directory: an application is somebody's work and sometimes their
// face, and the people who may look at it are the person who sent it and the
// people judging it. A public /uploads path would make the id the only thing
// standing between the two.
router.get('/uploads/:id', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  const id = String(req.params.id);
  // The id goes into a filesystem path, so it may only ever be what this route
  // hands out: 32 hex characters and a known extension. No dots, no slashes.
  if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(id)) return res.status(400).json({ error: 'bad_id' });

  try {
    const doc = await (await mongo.site.uploads()).findOne({ _id: id });
    if (!doc) return res.status(404).json({ error: 'not_found' });

    let allowed = doc.discordId === req.session.discord.id;
    if (!allowed) {
      const ctx = await staff.context(req);
      // Whoever reads applications may see what was attached to one. Anything
      // narrower would mean a reviewer looking at "here are my builds" and no
      // builds.
      allowed = !!ctx.abilities.viewApplications;
    }
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    const buf = await fs.readFile(path.join(DIR, id));
    res.setHeader('Content-Type', doc.mime);
    // Immutable: the id is the hash of the bytes, so this URL can never mean a
    // different image than it does right now.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    // The browser must render this, never run it or hand it to a plugin.
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found' });
    console.error('[upload read]', err);
    res.status(500).json({ error: 'read_failed' });
  }
});

// The router is the export (index.js mounts it directly); the limits ride along
// so routes/apply can enforce the same numbers rather than keep its own copy.
module.exports = router;
module.exports.MAX_PER_APPLICATION = MAX_PER_APPLICATION;
module.exports.MAX_BYTES = MAX_BYTES;
