'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const config = require('../config');
const session = require('../lib/session');

// Discord login. Mounted at the site root rather than under /api, because the
// browser is redirected here by Discord and these are pages in a flow, not JSON.

const AUTHORIZE = 'https://discord.com/api/oauth2/authorize';
const TOKEN = 'https://discord.com/api/v10/oauth2/token';
const ME = 'https://discord.com/api/v10/users/@me';
const STATE_COOKIE = 'gj_oauth';
const STATE_TTL_MS = 10 * 60 * 1000;

function safeReturn(to) {
  // Only same-site paths: an open redirect here would let someone hand out a
  // example.invalid login link that lands on their own page afterwards.
  const s = String(to || '/');
  return /^\/(?!\/)/.test(s) ? s : '/';
}

router.get('/auth/discord', (req, res) => {
  if (!config.discord.configured) return res.status(503).send('Discord login is not configured.');

  // State ties this callback to this browser: without it, anyone could feed a
  // victim a callback URL carrying their own code and log them into someone
  // else's account. Signed and cookie-held, so nothing server-side to expire.
  const nonce = crypto.randomBytes(16).toString('base64url');
  const back = safeReturn(req.query.return);
  const state = `${nonce}|${Buffer.from(back).toString('base64url')}`;
  session.setCookie(res, STATE_COOKIE, `${state}.${session.sign(state)}`, STATE_TTL_MS);

  const q = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  res.redirect(`${AUTHORIZE}?${q}`);
});

router.get('/auth/discord/callback', async (req, res) => {
  if (!config.discord.configured) return res.status(503).send('Discord login is not configured.');

  const raw = session.parseCookies(req.headers.cookie)[STATE_COOKIE] || '';
  const dot = raw.lastIndexOf('.');
  const state = dot > 0 ? raw.slice(0, dot) : '';
  const ok = dot > 0 && session.verify(state, raw.slice(dot + 1)) && state === String(req.query.state || '');
  session.setCookie(res, STATE_COOKIE, '', 0);

  if (!ok) return res.redirect('/?login=failed');
  if (!req.query.code) return res.redirect('/?login=cancelled');

  const back = safeReturn(Buffer.from(String(state).split('|')[1] || '', 'base64url').toString());

  try {
    const tokenRes = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: config.discord.redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const token = await tokenRes.json();

    const meRes = await fetch(ME, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!meRes.ok) throw new Error(`me ${meRes.status}`);
    const me = await meRes.json();

    // The access token is not kept: `identify` is all we asked for, and once we
    // know who they are there is nothing left to spend it on. Storing it would
    // only be a thing to leak.
    await session.create(res, {
      discord: {
        id: me.id,
        username: me.username,
        globalName: me.global_name || null,
        avatar: me.avatar || null,
      },
    });
    res.redirect(back);
  } catch (err) {
    console.error('[auth] discord callback:', err.message);
    res.redirect('/?login=failed');
  }
});

router.post('/auth/logout', async (req, res) => {
  await session.destroy(req, res);
  res.json({ ok: true });
});

module.exports = router;
