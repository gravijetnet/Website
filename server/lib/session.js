'use strict';

const crypto = require('crypto');
const config = require('../config');
const mongo = require('./mongo');

// Sessions live in Mongo; the cookie carries only an id and a signature. So the
// browser never holds anything worth forging, and revoking someone is a delete
// rather than a wait for their cookie to expire.

const COOKIE = config.session.cookie;

function sessions() {
  return mongo.collection(config.mongo.siteDb, 'sessions');
}

function sign(value) {
  return crypto.createHmac('sha256', config.session.secret).update(value).digest('base64url');
}

// Compared with timingSafeEqual: a plain === leaks, one byte at a time, how much
// of a forged signature was right.
function verify(value, signature) {
  if (!config.session.secret) return false;
  const expected = Buffer.from(sign(value));
  const got = Buffer.from(String(signature || ''));
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeMs) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (config.session.domain) bits.push(`Domain=${config.session.domain}`);
  if (maxAgeMs === 0) bits.push('Max-Age=0');
  else if (maxAgeMs) bits.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...list, bits.join('; ')]);
}

async function create(res, data) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await (await sessions()).insertOne({
    _id: id,
    ...data,
    createdAt: now,
    expiresAt: now + config.session.ttlMs,
  });
  setCookie(res, COOKIE, `${id}.${sign(id)}`, config.session.ttlMs);
  return id;
}

async function read(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  if (!verify(id, raw.slice(dot + 1))) return null;

  const doc = await (await sessions()).findOne({ _id: id });
  if (!doc) return null;
  if (doc.expiresAt < Date.now()) {
    await (await sessions()).deleteOne({ _id: id });
    return null;
  }
  return doc;
}

async function destroy(req, res) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (raw) {
    const dot = raw.lastIndexOf('.');
    if (dot > 0) await (await sessions()).deleteOne({ _id: raw.slice(0, dot) });
  }
  setCookie(res, COOKIE, '', 0);
}

// Attaches req.session (or null). Never throws: a broken session store must not
// take the public pages down with it.
async function attach(req, res, next) {
  try {
    req.session = await read(req);
  } catch {
    req.session = null;
  }
  next();
}

module.exports = { create, read, destroy, attach, setCookie, parseCookies, sign, verify };
