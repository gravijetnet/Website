'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // behind nginx + Cloudflare

// --- Session --------------------------------------------------------------
// Before the routes, so anything downstream can read req.session. Never throws:
// a broken session store must not take the public pages down with it.
const session = require('./lib/session');
app.use(session.attach);

// Discord's callback lands on a page, not on JSON, so these sit at the root.
app.use(require('./routes/auth'));

// --- API ------------------------------------------------------------------
const api = express.Router();
api.use(require('./routes/network'));
api.use(require('./routes/leaderboards'));
api.use(require('./routes/player'));
api.use(require('./routes/players'));
api.use(require('./routes/skin'));
api.use(require('./routes/team'));
api.use(require('./routes/rules'));
api.use(require('./routes/me'));
api.use(require('./routes/my'));
api.use(require('./routes/apply'));
api.use(require('./routes/link'));
api.use(require('./routes/report'));
api.use(require('./routes/appeal'));
api.use(require('./routes/feedback'));
api.use(require('./routes/dashboard'));
api.use(require('./routes/moderation'));
api.use(require('./routes/admin'));
api.use(require('./routes/live'));
api.use(require('./routes/discord'));
api.use(require('./routes/panel'));
api.use(require('./routes/uploads'));
app.use('/api', api);

// --- Static frontend ------------------------------------------------------
const PUBLIC = path.join(__dirname, '..', 'public');
const ASSETS = path.join(PUBLIC, 'assets');

// The whole asset tree hashed into one id, and the tree is served from a
// directory named after it. A deploy therefore changes every asset URL at once,
// and a browser physically cannot pair a file from this deploy with one from the
// last — which is the bug this exists for. It shipped: an old icons.js (no
// `soundOn`) beside a fresh main.js put the literal string "undefined" in the
// sound button, and an old style.css (no rule for `.mode-row .glyph svg`) left
// the mode icons at an SVG's default size.
//
// Headers cannot fix it here. The origin sends `no-cache`, and Cloudflare's
// Browser Cache TTL rewrites it to `max-age=14400` at the edge — verified with a
// cache-buster against a confirmed MISS, so it is not stale-edge, it is policy,
// and there are no Cloudflare credentials on this box to change it. A path we
// choose is a thing we control; a header we send is not.
//
// Content, not mtime: a git checkout rewrites mtimes and would churn the id on
// every deploy whether or not anything changed.
function hashTree(dir) {
  const h = crypto.createHash('sha1');
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(e.name).update(fs.readFileSync(p));
    }
  })(dir);
  return h.digest('hex').slice(0, 10);
}
const VER = hashTree(ASSETS);

// Versioned: the id changes whenever any byte does, so this can never go stale.
app.use(
  `/assets-${VER}`,
  express.static(ASSETS, { index: false, immutable: true, maxAge: '365d' }),
);

// Unversioned, still mounted: og:image points here (a stable URL matters more to
// a social scraper than freshness does), and it keeps any path missed by the
// rewrite working rather than 404ing. Revalidate, since these URLs never change.
const IMMUTABLE = /\.(woff2|png|webp|svg|jpg|mp3|ogg|wav)$/;
app.use(
  express.static(PUBLIC, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader(
        'Cache-Control',
        IMMUTABLE.test(filePath) ? 'public, max-age=2592000' : 'no-cache',
      );
    },
  }),
);

// The shell names the entry points, so it is what pins a version — it must never
// be held. Rewritten once at boot, not per request.
// `="/assets/` only: og:image is an absolute https:// URL and is left alone.
const SHELL = fs
  .readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace(/="\/assets\//g, `="/assets-${VER}/`);

// SPA fallback: client-side routes render the app shell.
//
// A request for a *file* that express.static didn't find must 404 rather than
// fall through to here — otherwise a missing or mistyped asset silently returns
// index.html with a 200, and the browser tries to parse HTML as a font/script.
// Only extensionless paths (/, /players, /player/foo) are real SPA routes.
const HAS_EXTENSION = /\.[a-z0-9]{2,5}$/i;

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (HAS_EXTENSION.test(req.path)) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(SHELL);
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

const server = app.listen(config.port, config.host, () => {
  console.log(`gravijet-stats listening on http://${config.host}:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
