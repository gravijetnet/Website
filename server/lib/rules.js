'use strict';

// The rules of the network.
//
// These used to be generated from Phoenix's punishment ladders, on the argument
// that the ladders are what actually bans people so anything else would drift.
// That was true and it was still wrong, because it could only ever state the
// five things this network punishes on a ladder. A rulebook is not a list of
// ladders: "don't ghost for your friend", "your account is your responsibility",
// "report it, don't farm it" and "don't argue the ban in chat, appeal it" are
// all real rules, none of them have a ladder, and a page that could not say them
// left players to guess and staff to enforce things nobody had written down.
//
// So the rules are written here and the ladders are read as *consequences*. Where
// a rule has a ladder, routes/rules.js pairs it up and the page prints the real
// escalation out of Phoenix — so the wording lives here, the punishment stays in
// the core, and neither invents the other. A rule with no ladder simply says what
// it is; a ladder with no rule is a hole this file should fill.
//
// Admin and above can edit all of this from Spielplatz; what follows is only the
// seed. See routes/rules.js — the stored copy wins once one exists.

// `ladder` is a Phoenix punishment-ladder _id. Anything named here must exist in
// px-punishmentLadders or the pairing silently shows no consequence.
const SECTIONS = [
  {
    id: 'fair-play',
    title: 'Fair play',
    intro: 'This is a practice network. The whole point is finding out who is actually better, so anything that answers that question for you is the one thing we will not have.',
    rules: [
      {
        id: 'cheating',
        title: 'Play with your own hands',
        ladder: 'Cheating',
        body: 'No client, mod, macro or script that aims, reaches, times, clicks or builds for you. The test is simple: if it makes a decision you would otherwise have to make, it is cheating.',
        detail: 'Clients like Lunar, Badlion and PvP-focused Fabric setups are fine, and so is anything that only changes how the game looks or how fast it runs — FPS mods, shaders, a bigger hitmarker, whatever you like. Killaura, reach, autoclickers, macros, velocity mods, scaffold and printer-style build assists are not, and they are all detectable.',
      },
      {
        id: 'consistency',
        title: 'Play like it is the same person every time',
        body: 'Dropping your cheats when a moderator is watching, or playing at your real level only in ranked, does not make you clean. Staff judge the whole picture, not one screen recording.',
      },
      {
        id: 'running',
        title: 'In a duel, duel',
        ladder: 'RunningCamping',
        body: 'Running out the clock, sitting in a corner or refusing to engage to force a draw wastes the time of someone who queued to fight. Play the game you queued for.',
      },
      {
        id: 'throwing',
        title: 'Do not throw, and do not boost',
        body: 'Losing on purpose to inflate a friend, queue-sniping to farm each other, and any other arrangement that manufactures a result are all the same offence. Stats that were not earned get deleted along with the punishment.',
      },
      {
        id: 'teaming',
        title: 'No teaming where it is not a team mode',
        body: 'In FFA and in 1v1, everyone else is an opponent. Cornering someone with a friend is not a strategy, it is two people ruining one person\'s game.',
      },
      {
        id: 'ghosting',
        title: 'Do not ghost',
        body: 'If you are spectating a match, what you can see stays with you. Relaying position, health or inventory to someone still playing decides a fight they should have decided.',
      },
      {
        id: 'bugs',
        title: 'Report bugs, do not farm them',
        body: 'Finding something broken is not against the rules — using it is. Tell us and it gets fixed, and the people who consistently do are the people we hand Beta-Tester to. Keep it to yourself and use it to win and it is treated exactly like cheating, because it does the same thing.',
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat and conduct',
    intro: 'Losing is annoying. It is not a licence.',
    rules: [
      {
        id: 'toxicity',
        title: 'Do not make this miserable for people',
        ladder: 'Toxicity',
        body: 'Harassment, targeted insults, threats and telling people to hurt themselves are punished on sight, whoever started it and whoever won.',
        detail: 'Trash talk in a duel is not this rule. There is a line between "ez" and following someone across three lobbies, and everybody knows where it is.',
      },
      {
        id: 'discrimination',
        title: 'Nothing about who someone is',
        ladder: 'Discrimination',
        body: 'Race, ethnicity, nationality, religion, gender, sexuality, disability. There is no joking version of this rule, no reclaimed version, and no context in which it is fine.',
      },
      {
        id: 'spam',
        title: 'Leave chat usable',
        ladder: 'Spamming',
        body: 'No repeated messages, no walls of text, no filling the channel so nobody else can get a word in.',
      },
      {
        id: 'advertising',
        title: 'Do not advertise other servers',
        body: 'Links to example.invalid, YouTube and Twitch go through. Everything else is filtered, and posting another network\'s address is the one kind of link we treat as an offence rather than a mistake.',
      },
      {
        id: 'privacy',
        title: 'Nobody\'s personal information, ever',
        body: 'Real names, addresses, schools, workplaces, photos, IPs. Posting them or threatening to is the fastest way off this network — it does not escalate, it does not get a warning, and it is the one thing we will not accept an appeal on.',
      },
      {
        id: 'impersonation',
        title: 'Be yourself',
        body: 'Do not claim to be staff, do not pretend to be another player, and do not use a name or skin built to be mistaken for one. Staff rank is visible in game and on this site — check there, not in chat.',
      },
      {
        id: 'scamming',
        title: 'No scamming',
        body: 'Deals involving ranks, accounts or real money are not something we host, mediate or refund. If you arrange one anyway and it goes wrong, that is between you and them — but scamming somebody on our network is still an offence here.',
      },
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    intro: 'One person, one account, and it is yours.',
    rules: [
      {
        id: 'responsibility',
        title: 'Your account is your responsibility',
        body: 'Everything done on it was done by you as far as we are concerned. Your brother, your friend and the person you sold it to are not a defence, because we have no way to tell them apart from you.',
      },
      {
        id: 'alts',
        title: 'Alts are fine — until they are used to dodge something',
        body: 'Play on as many accounts as you like. The moment one is used to get around a punishment, escape a reputation or queue against yourself, all of them are in scope.',
      },
      {
        id: 'evasion',
        title: 'Do not evade a ban',
        body: 'Joining on another account while banned gets that account banned too, and turns a temporary ban into a permanent one. The core matches accounts on its own — it is usually the evasion, not the original offence, that ends someone\'s time here for good.',
      },
      {
        id: 'sharing',
        title: 'Do not sell, buy or share accounts or ranks',
        body: 'Ranks are granted to a person, not to a login. An account that changes hands loses them.',
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reports and appeals',
    intro: 'Both of these exist so that nothing has to be settled in chat.',
    rules: [
      {
        id: 'how-to-report',
        title: 'Report it, do not fight it',
        body: 'Use /report in game or the form in your dashboard. Say what happened, roughly when, and which mode — a moderator has to be able to find it. A clip is worth more than a paragraph.',
      },
      {
        id: 'callouts',
        title: 'Do not call people out in chat',
        body: 'Announcing that somebody is hacking does not get them banned any faster. It does start an argument, and it tips them off. Report it and say nothing.',
      },
      {
        id: 'false-reports',
        title: 'Do not report people for beating you',
        body: 'Reports are read by humans whose time is finite. Filing them against someone who was simply better, or filing the same one ten times, is itself punishable.',
      },
      {
        id: 'dms',
        title: 'Do not DM staff about punishments',
        body: 'They will not action it, and it does not move you up the queue. Everything goes through a report or an appeal so there is a record of it.',
      },
      {
        id: 'appeals',
        title: 'Appeal once, and be honest',
        body: 'One appeal per punishment, from your dashboard, with the punishment ID that was printed on the screen when it landed. Saying it was your brother when the logs say otherwise is how a fourteen-day ban becomes a permanent one.',
      },
      {
        id: 'in-the-moment',
        title: 'A staff decision stands in the moment',
        body: 'If you think it was wrong, appeal it — that is what appeals are for, and they get read by somebody other than whoever made the call. Arguing it in chat is a separate offence from whatever you were punished for.',
      },
    ],
  },
  {
    id: 'staff',
    title: 'What you can expect from us',
    intro: 'Rules that bind the people enforcing them, which is the only kind worth printing.',
    rules: [
      {
        id: 'staff-bound',
        title: 'Staff are held to these rules, and harder',
        body: 'A rank is not a shield. Every moderation decision on this network is recorded against the name of whoever made it, and those records are readable by every member of staff — not only by the ranks senior enough to have made them.',
      },
      {
        id: 'reasons',
        title: 'You will always be told why',
        body: 'Every punishment carries a reason and an ID. If you were given neither, that is a mistake worth appealing on its own.',
      },
      {
        id: 'no-selling-decisions',
        title: 'Nothing here is for sale',
        body: 'Ranks do not buy leniency, and a purchase has never once affected a punishment. Media and Partner ranks are given for work, not for the ban they would like reversed.',
      },
    ],
  },
  {
    id: 'the-rest',
    title: 'The rule behind the rules',
    rules: [
      {
        id: 'not-exhaustive',
        title: 'This list is not a contract',
        body: 'It cannot name everything, and it is not meant to. If you have found something that is obviously ruining the game for other people and is technically not written above, staff will still act on it, and "it does not say I cannot" has never once worked. Play like you want other people to keep playing here.',
      },
      {
        id: 'elsewhere',
        title: 'This applies wherever Gravijet is',
        body: 'The Discord, this website and the game are one network. Being unbearable in one of them is being unbearable on Gravijet, and it is actioned in all three.',
      },
    ],
  },
];

// --------------------------------------------------------------- the store

const mongo = require('./mongo');
const colors = require('./colors');
const { invalidate } = require('./cache');

const DOC_ID = 'rules';

/**
 * The live rulebook: whatever Spielplatz last saved, or the seed above if nobody
 * has edited it yet.
 *
 * The seed is not a fallback for a failed read — if Mongo is down this throws,
 * because quietly serving the original wording to a network whose rules have
 * since changed is worse than serving nothing.
 */
async function load() {
  const doc = await (await mongo.site.rules()).findOne({ _id: DOC_ID });
  if (!doc) return { sections: SECTIONS, updatedAt: null, updatedBy: null };
  return { sections: doc.sections, updatedAt: doc.updatedAt || null, updatedBy: doc.updatedBy || null };
}

async function save(sections, by) {
  const now = Date.now();
  await (await mongo.site.rules()).replaceOne(
    { _id: DOC_ID },
    { _id: DOC_ID, sections, updatedAt: now, updatedBy: by },
    { upsert: true },
  );
  // The public page caches; an edit nobody can see for five minutes reads as a
  // save that did not work.
  invalidate();
  return now;
}

// --------------------------------------------------------- the consequences

function shapeStep(step) {
  return {
    order: Number(step.order) || 0,
    type: String(step.type || '').toUpperCase(),
    duration: Number(step.duration) || 0,
    ip: !!step.ip,
  };
}

/**
 * Pairs each rule with the Phoenix ladder it names.
 *
 * A rule whose ladder has gone missing keeps its wording and loses its
 * consequence, rather than disappearing: the rule is still the rule, and a
 * silently dropped one is how a network ends up enforcing something it does not
 * publish.
 */
async function withLadders(sections) {
  const ladders = await (await mongo.phoenix.punishmentLadders()).find({}).toArray();
  const byId = new Map(ladders.filter((l) => !l.hidden).map((l) => [l._id, l]));

  return sections.map((s) => ({
    ...s,
    rules: s.rules.map((r) => {
      const l = r.ladder ? byId.get(r.ladder) : null;
      if (!l) return { ...r, consequence: null };
      return {
        ...r,
        consequence: {
          id: l._id,
          label: colors.strip(l.reason || l._id),
          // Higher priority means the network treats it as more serious.
          priority: Number(l.priority) || 0,
          steps: (l.ladder || []).map(shapeStep).sort((a, b) => a.order - b.order),
        },
      };
    }),
  }));
}

module.exports = { SECTIONS, load, save, withLadders };
