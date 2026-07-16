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
app.use(
  express.static(PUBLIC, {
    index: false,
    setHeaders(res, filePath) {
      if (/\.(woff2|png|webp|svg|jpg)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
      }
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
