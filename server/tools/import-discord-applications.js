'use strict';

// One-time import: the applications people sent through the Discord bot, moved
// into the website's store so they survive the bot losing that feature.
//
// Run:  node server/tools/import-discord-applications.js [--commit]
//
// Without --commit it prints what it would do and writes nothing. Re-running is
// safe: each row keeps a deterministic id derived from the bot's own row id, so
// a second run updates the same six documents rather than making six more.
//
// Why the questions are copied in here rather than read from the bot: the bot's
// applicationHandler.js is the file being deleted, and an answer without the
// question it answers is close to meaningless — "5-10h" needs "How often do you
// usually play per week?" standing next to it. These are frozen exactly as they
// were asked, which is also why they are not the (better) questions in
// lib/applications: rewording a question later must never silently change what
// an old applicant was asked. That rule is already why live applications store
// their own qa pairs; this is the same rule applied backwards.

const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const mongo = require('../lib/mongo');

const DB_PATH =
  process.env.BOT_DB
  || '/var/lib/featherpanel/volumes/495d3305-090a-4fa3-b22b-5c01547b4cca/ticket_bot.db';

// The bot's question set, exactly as it asked them.
const QUESTIONS = {
  Helper: [
    'What is your Minecraft in-game name?',
    'How old are you?',
    'What timezone do you live in?',
    'Why do you want to become staff on our server?',
    'What do you think about our server?',
    'How active do you plan to be on the server?',
    'What motivates you to become staff on our server?',
    'Are you staff on other servers? If so, which ones? Please provide details.',
    'What are your goals for the next 2 months on our server?',
    'How would you handle a player who is obviously hacking?',
    'Tell us a bit about yourself.',
    'Do you have any questions for us?',
  ],
  Builder: [
    'What is your Minecraft in-game name?',
    'How old are you?',
    'What timezone do you live in?',
    'Why do you want to become a Builder on our server?',
    'What do you think about our server?',
    'How active do you plan to be?',
    'What motivates you to become a Builder on our server?',
    'Are you staff on other servers? If so, please provide details.',
    'What are your goals for the next 2 months on our server?',
    'Show us some of your builds. (URLs only, no file uploads.)',
    'Tell us a bit about yourself.',
    'Do you have any questions for us?',
  ],
  Developer: [
    'What is your Minecraft in-game name?',
    'How old are you?',
    'What timezone do you live in?',
    'Why do you want to become a Developer on our server?',
    'What do you think about our server?',
    'How active do you plan to be?',
    'What motivates you to become a Developer on our server?',
    'Are you staff on other servers? If so, please provide details.',
    'What are your goals for the next 2 months on our server?',
    'Show us some of your work! (No file uploads; please provide links or code snippets.)',
    'Tell us a bit about yourself.',
    'Do you have any questions for us?',
  ],
  Media: [
    'Your YouTube, Twitch, or TikTok URL',
    'What is your Minecraft in-game name?',
    'Why do you want the Media rank on our server?',
    'How long have you been creating content about our server?',
    'How often do you upload content?',
    'What do you think about our server?',
    'Do you have any questions for us?',
  ],
  'Beta-Tester': [
    'What is your Minecraft in-game name?',
    'Why do you want to become a Beta-Tester?',
    'How often do you usually play Minecraft per week?',
    'Have you participated in early-access or beta programs on other servers? If so, which ones?',
    'Are you willing to provide feedback and report bugs you find?',
    'What are you most excited to try or see on our server?',
    'How would you describe your behavior on multiplayer servers?',
    'Do you have any questions for us?',
  ],
};

// The bot's category -> the website's role key. Beta-Tester is the same rank
// Phoenix calls Tester; the website's form key is what matters here.
const ROLE_KEY = {
  Helper: 'helper',
  Builder: 'builder',
  Developer: 'developer',
  Media: 'media',
  'Beta-Tester': 'beta-tester',
};

// The bot said "denied"; the website says "rejected". Same decision, and one
// word for it is better than two. `cancelled` and `timeout` are kept as they
// are: they are not decisions, and flattening them into "rejected" would put
// words in a reviewer's mouth.
const STATUS = {
  accepted: 'accepted',
  denied: 'rejected',
  rejected: 'rejected',
  pending: 'pending',
  cancelled: 'cancelled',
  timeout: 'timeout',
};

// Deterministic, so the import is idempotent. Namespaced so it can never collide
// with a randomUUID from a live application.
function idFor(botRowId) {
  return `discord-${crypto.createHash('sha1').update(`bot-application:${botRowId}`).digest('hex').slice(0, 24)}`;
}

function parseAnswers(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : [];
  } catch {
    return [];
  }
}

function toMillis(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function build(row) {
  const questions = QUESTIONS[row.category];
  if (!questions) return { skip: `unknown category ${row.category}` };

  const answers = parseAnswers(row.answers);
  if (!answers.length) return { skip: 'no answers' };

  // A pairing that has drifted is worth flagging rather than silently zipping:
  // if the bot's question list changed after these were answered, the answers
  // line up with questions nobody asked.
  const drift = answers.length !== questions.length;

  const status = STATUS[row.status] || row.status;
  const submittedAt = toMillis(row.submitted_at) || toMillis(row.created_at) || toMillis(row.started_at);

  return {
    doc: {
      _id: idFor(row.id),
      role: ROLE_KEY[row.category] || String(row.category).toLowerCase(),
      roleLabel: row.category,
      status,
      discordId: row.user_id,
      discordName: row.username,
      qa: answers.map((a, i) => ({ q: questions[i] || `(question ${i + 1} — no longer on record)`, a })),
      submittedAt,
      reviewedAt: status === 'pending' ? null : submittedAt,
      // The bot stored only the reviewer's Discord id, so that is all there is.
      // Inventing a display name for them would be inventing evidence.
      reviewedBy: row.reviewed_by ? { id: row.reviewed_by, name: null, ranks: [] } : null,
      note: row.review_reason || null,
      // Where this came from, so nobody later mistakes a 2026 Discord DM thread
      // for something sent through this website.
      source: 'discord',
      importedAt: Date.now(),
    },
    drift,
  };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db.prepare('SELECT * FROM applications ORDER BY id').all();
  db.close();

  console.log(`${rows.length} rows in ${path.basename(DB_PATH)}\n`);

  const docs = [];
  for (const row of rows) {
    const { doc, skip, drift } = build(row);
    if (skip) {
      console.log(`  skip  #${row.id} ${row.category} — ${skip}`);
      continue;
    }
    console.log(
      `  take  #${row.id} ${String(row.category).padEnd(12)} ${String(doc.status).padEnd(9)} ${doc.discordName}`
      + `${drift ? '  [!] answer/question count differs' : ''}`,
    );
    docs.push(doc);
  }

  if (!commit) {
    console.log(`\n${docs.length} would be imported. Re-run with --commit to write them.`);
    return;
  }

  const col = await mongo.site.applications();
  let created = 0;
  let updated = 0;
  for (const doc of docs) {
    const res = await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
    if (res.upsertedCount) created++;
    else updated++;
  }
  console.log(`\nimported: ${created} new, ${updated} already present and refreshed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
