'use strict';

const express = require('express');
const router = express.Router();

// Player skins are drawn by third-party renderers. StarlightSkins' 3D full-body
// render takes seconds on a cold request, and the browser used to fetch it
// directly — so every visitor paid that cost on every profile view, and the
// response never passed through anything of ours that could remember it.
//
// Proxying makes the skin our URL, and two things follow. This process can hold
// the bytes, and so can Cloudflare: these paths end in .png, which is on the
// edge's default list of cacheable extensions, so the second person to look at a
// profile is served from their nearest datacentre instead of from a render farm.
//
// The upstreams stay third-party on purpose — rendering a skin ourselves means
// shipping Mojang's model, and it is not worth owning that to save a proxy hop.

const MAX_ENTRIES = 400;
const TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const BENCH_MS = 5 * 60 * 1000;

const cache = new Map(); // key -> { buf, type, at }
const benched = new Map(); // origin -> retry no earlier than

// A renderer that is down should not be charged for on every cold request.
// StarlightSkins — the nicest of them, and the one this page was built on — has
// been answering 502, and crafatar 521; at the time of writing mc-heads is the
// only one alive. So a source that fails goes on the bench and is tried again a
// few minutes later: cold requests stay fast while it is dead, and the better
// render comes back by itself if it recovers.
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function isBenched(url) {
  const until = benched.get(originOf(url));
  if (!until) return false;
  if (Date.now() >= until) {
    benched.delete(originOf(url));
    return false;
  }
  return true;
}

function put(key, buf, type) {
  // Map preserves insertion order, so the first key is the oldest. Renders are
  // all roughly one size, which makes a count a good enough proxy for bytes.
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { buf, type, at: Date.now() });
}

async function fetchImage(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'example.invalid' } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    // An upstream that is down often answers 200 with an HTML error page.
    if (!type.startsWith('image/')) return null;
    return { buf: Buffer.from(await r.arrayBuffer()), type };
  } catch {
    return null; // timed out, DNS, connection reset — the next source gets a go
  } finally {
    clearTimeout(timer);
  }
}

function send(res, img) {
  res.setHeader('Content-Type', img.type || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.end(img.buf);
}

// Try each source in order; the first image wins.
async function attempt(key, sources, ignoreBench) {
  let tried = 0;
  for (const url of sources) {
    if (!ignoreBench && isBenched(url)) continue;
    tried++;
    const img = await fetchImage(url);
    if (img) {
      benched.delete(originOf(url));
      put(key, img.buf, img.type);
      return { img, tried };
    }
    benched.set(originOf(url), Date.now() + BENCH_MS);
  }
  return { img: null, tried };
}

async function serve(res, key, sources) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return send(res, hit);

  let { img, tried } = await attempt(key, sources, false);
  // Every source was benched, so nothing was actually asked. Better a slow image
  // than a hole: ignore the bench rather than serve nothing.
  if (!img && tried === 0) ({ img } = await attempt(key, sources, true));

  if (img) return send(res, img);
  // A stale render beats a broken image — a skin nobody changed is still theirs.
  if (hit) return send(res, hit);
  res.status(502).end();
}

// A UUID (dashed or not) or a Minecraft name — both are valid upstream. The
// value is interpolated into a URL, so nothing else is allowed through.
const ID = /^[A-Za-z0-9_-]{1,36}$/;

function ident(file) {
  const id = String(file || '').replace(/\.png$/i, '');
  return ID.test(id) ? id : null;
}

router.get('/skin/head/:file', async (req, res) => {
  const id = ident(req.params.file);
  if (!id) return res.status(400).end();
  const size = Math.min(512, Math.max(16, parseInt(req.query.s, 10) || 64));
  await serve(res, `head:${id}:${size}`, [
    `https://mc-heads.net/avatar/${id}/${size}`,
    `https://crafatar.com/avatars/${id}?size=${size}&overlay`,
  ]);
});

router.get('/skin/body/:file', async (req, res) => {
  const id = ident(req.params.file);
  if (!id) return res.status(400).end();
  await serve(res, `body:${id}`, [
    `https://starlightskins.lunareclipse.studio/render/walking/${id}/full`,
    `https://mc-heads.net/body/${id}/300`,
  ]);
});

module.exports = router;
