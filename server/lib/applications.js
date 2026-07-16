'use strict';

// The application questions, taken from the Discord bot's set and rewritten.
// The bot keeps its own copy and is not touched by this.
//
// What was wrong with the originals, and what these do instead:
//
//   - Every role asked "Why do you want to become X?" AND "What motivates you to
//     become X?" — the same question twice, and nobody answers it differently
//     the second time. Merged.
//   - "What do you think about our server?" rewards flattery and separates
//     nobody, because every answer is "it's great". Replaced with a question
//     that costs something to answer: name one thing you'd change.
//   - Beta-Tester asked "Are you willing to provide feedback and report bugs?"
//     A question whose answer is always yes is a question you did not ask.
//     Replaced with one that only somebody who has actually done it can answer.
//   - "Are you staff on other servers? If so, which ones?" collects a list.
//     Asking what went wrong there collects the truth.
//   - Helper had one situational question. Those are the only part of a staff
//     application that predicts anything, so it has three now, and the filler
//     is gone. Twelve questions became eleven that each do work.
//
// `long: true` renders a textarea; the rest are single lines.

const q = (text, long = true) => ({ text, long });
const short = (text) => q(text, false);

const IGN = short('What is your Minecraft in-game name?');
const AGE = short('How old are you?');
const TZ = short('Which timezone are you in, and roughly which hours are you online?');
const CLOSER = q('Anything you want to ask us?');
const CHANGE = q("What is one thing about Gravijet you would change, and why?");

const ROLES = {
  helper: {
    label: 'Helper',
    blurb: 'Moderating the network: handling reports, watching for cheaters, keeping chat usable.',
    questions: [
      IGN,
      AGE,
      TZ,
      q('Why do you want to help run Gravijet?'),
      q('How many hours a week can you realistically give this? We would rather know now than find out later.'),
      q('A player is obviously cheating, but you have no proof that would convince anyone else. What do you do?'),
      q('Someone you are friendly with breaks a rule in front of you. Walk us through what happens next.'),
      q('A player is furious at you in chat and will not stop. What do you do?'),
      q('Have you been staff somewhere else? Tell us what went wrong there.'),
      CHANGE,
      CLOSER,
    ],
  },
  builder: {
    label: 'Builder',
    blurb: 'Making the maps and lobbies people actually play in.',
    questions: [
      IGN,
      AGE,
      TZ,
      q('Why do you want to build for Gravijet?'),
      q('Show us your work. Links only — imgur, Planet Minecraft, a video. No file uploads.'),
      q('Of what you just linked, which did you build alone and which with other people?'),
      q('Which style are you strongest at, and which are you weakest at?'),
      q('Roughly how long does a mid-size build take you, start to finish?'),
      CHANGE,
      CLOSER,
    ],
  },
  developer: {
    label: 'Developer',
    blurb: 'Writing and maintaining the plugins the network runs on.',
    questions: [
      IGN,
      AGE,
      TZ,
      q('Why do you want to develop for Gravijet?'),
      q('Show us code you have written — a repository, a gist, a plugin. Links only.'),
      q('In what you just linked, which parts did you write yourself, and which did you copy or generate?'),
      q('Which languages and APIs do you actually know well? Be specific about Java and the Bukkit/Paper API.'),
      q('Tell us about a bug that took you far too long to find. What was it in the end?'),
      CLOSER,
    ],
  },
  media: {
    label: 'Media',
    blurb: 'Making videos or streams about the network.',
    questions: [
      short('Your channel URL (YouTube, Twitch or TikTok)'),
      IGN,
      q('How often do you upload, and what are your view numbers honestly? Views, not subscribers.'),
      q('Have you made content about Gravijet before? Link it.'),
      q('What would you make for Gravijet in your first month?'),
      q('What do you want from us in return?'),
      CLOSER,
    ],
  },
  'beta-tester': {
    label: 'Beta-Tester',
    blurb: 'Playing things before they are finished, and reporting what breaks.',
    questions: [
      IGN,
      q('Why do you want to test rather than just play?'),
      q('How many hours a week can you give it?'),
      q('Describe the last bug you found in any game. How would someone else reproduce it?'),
      q('You find a bug that gives you an advantage in a ranked match. What do you do?'),
      q('Have you tested for another server before? What did that actually involve?'),
      CLOSER,
    ],
  },
};

function role(key) {
  return ROLES[String(key || '').toLowerCase()] || null;
}

function list() {
  return Object.entries(ROLES).map(([key, r]) => ({
    key,
    label: r.label,
    blurb: r.blurb,
    count: r.questions.length,
  }));
}

module.exports = { ROLES, role, list };
