'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // behind nginx + Cloudflare

// --- API ------------------------------------------------------------------
const api = express.Router();
api.use(require('./routes/network'));
api.use(require('./routes/leaderboards'));
api.use(require('./routes/player'));
api.use(require('./routes/players'));
app.use('/api', api);

// --- Static frontend ------------------------------------------------------
const PUBLIC = path.join(__dirname, '..', 'public');
// The JS modules import each other by path and carry no version in their URLs,
// so they must expire together or not at all. They didn't: express.static's
// default is `public, max-age=0`, which Cloudflare reads as "cacheable, no
// opinion" and rewrites to its own 4h browser TTL — a visitor could then hold a
// four-hour-old icons.js beside a fresh main.js. That is a real bug, not a
// theoretical one: it is why the sound button rendered the string "undefined"
// (old icons.js, no `soundOn`) and why the mode icons rendered enormous (old
// style.css, no rule for `.mode-row .glyph svg`, so the SVGs fell back to their
// default size). `no-cache` still stores the file, it just forces revalidation,
// so the ETag turns each check into a cheap 304 and the set can never skew.
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
  // The shell names every script and stylesheet, so a stale one pins a stale set.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC, 'index.html'));
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
