# Spielplatz — the control plan

Everything the panel could do with Minecraft and Discord, what it already does,
and what is genuinely impossible. Written against the real `pxAPI 2.0` surface
rather than against what would be nice — every entry below names the call or the
collection it would go through, and anything without one is marked as such.

---

## How anything here reaches the game

There are five roads, and picking the wrong one is the usual way a feature ends
up half-working. They are not interchangeable.

| Road | Table | Who runs it | Use it for |
|---|---|---|---|
| **Claimed queue** | `mod_actions` | exactly one server | Anything the core propagates itself — punishments, grants, staff alerts |
| **Fan-out** | `network_broadcasts` | every server reads every row | Announcements, and anything aimed at one player wherever they are |
| **Config queue** | `config_actions` | exactly one server | Ranks, ladders, whitelist — config the core holds in memory |
| **Store-direct** | Mongo | nobody; read at boot | Config Phoenix only *reads* — report menu, chat filters, tags |
| **Discord queue** | `discord_tasks` | the bot | Roles, and everything Discord-side |
| *(upward)* | `network_servers` | plugin writes, site reads | Live state the site has no other way to see |
| **The host** | FeatherPanel API | the panel | The layer *below* Phoenix — power, container console, backups, worlds |

Two rules that fall out of this, both learned the hard way:

- **If the core propagates it, exactly one server may send it.** A staff alert
  fanned out prints once per server. That is why alerts are a claimed job.
- **If the core does *not* propagate it, every server must do it locally.** A
  broadcast to all players has no network-wide call, so it fans out.

---

## What exists today

**Moderation** — ban, mute, kick, blacklist; unban/unmute (one click, labelled);
reports, appeals, applications; hide players from the public lists; full audit of
every decision.

**Ranks & permissions** — create, rename, recolour, prefix/suffix/tab-prefix,
priority, price, every flag, inheritance; add and remove permissions *including
nodes no rank has ever carried*; promote/demote through Discord with the usual
embed.

**Network config** — punishment ladders (retime, retype, redecay, remove rungs);
the report menu players pick from; the chat filter word list (regex compiled
before it saves); cosmetic tags; the public rulebook.

**Operations** — network announcements; staff alerts as the core's own prefixed
alert; message a player or move them between servers; live server list with
per-server load; maintenance (close/open the network, let named players through);
config backups with restore.

**Records** — every command run, every line of chat, searchable by player or by
text; who has signed in; per-person access overrides.

**The host** (FeatherPanel) — every server with its state, memory, disk and node;
power start/restart/stop/kill; the container's own console; backups taken,
restored and deleted; worlds; and each box's operators, whitelist and vanilla
bans. Distinct from Phoenix on purpose: a restart here takes the container away,
and a ban here is one box's file rather than a punishment on anybody's record.

---

## Phase A — more with the Minecraft servers

**Status: done, except A2 and A11 (see below).** Ordered by what a moderator
reaches for most, not by what is easiest.

### A1 · The player dossier
One page that answers everything about a player. Today the card shows ranks,
punishments and alts; it should also show:
- **Login & IP history** — `px-logins` (`{target, ip, login, logout}`), or
  `ILoginHandler.getDatabaseLogins(uuid)`. Shared IPs are how alts are actually
  found.
- **Disguise history** — `DisguiseHandler.fetchDisguiseHistory(uuid)`, and
  `px-disguiseHistory`.
- **VPN/proxy data** — `IAntiVPNHandler.getAntiVPNData(uuid)`.
- **Cooldown count** — `ICooldownHandler.getCooldownCount(uuid)`.
- **Their chat, filtered to them** — the log tab already holds it.

### A2 · Staff notes on a player — **not built**
`IProfile.getNotes()` returns `INote`, but the collection is empty, so there is
no observable shape to write against, and `INote` has no constructor in the API —
the same gap permissions had. It would need the same reflection treatment.
Deliberately left rather than guessed at. The thing every moderation team improvises
in a Discord channel, kept where the next person will actually find it.

### A3 · Chat snapshots as evidence
`IChatSnapshotHandler.createSnapshot(uuid)` / `loadSnapshots(uuid)` /
`getByNiceId(id)`. Take a snapshot of what was said and attach it to a report, so
"they were abusive" comes with the transcript. This is the single biggest upgrade
to report handling available.

### A4 · Warn
`PunishmentType.WARN` already exists and is not offered anywhere. A step below a
mute, on the same ladder machinery.

### A5 · Force logout
`ILoginHandler.logoutPlayer(uuid)` — get someone off the network without a
punishment on their record.

### A6 · Scheduled restarts
`RebootHandler.reboot(sender, seconds)`, `.cancel(sender)`, `.isRebootScheduled()`,
`.getTimeRemaining()`. Schedule a restart with the countdown the players already
know, per server, and cancel it. Pairs with the Servers page.

### A7 · Clear cooldowns
`ICooldownHandler.clearCooldowns(uuid)`.

### A8 · Anti-VPN bypass
`IAntiVPNHandler.whitelist(uuid, …)` / `.unwhitelist(…)` — for the player on a
legitimate VPN who cannot get in.

### A9 · Reset staff security
`ISecurityHandler.removeSecurity(uuid)` / `.hasSecurity(uuid)`. This is what
produces `[Security] Unverified User`; being able to clear it from the panel is
the fix for a locked-out admin.

### A10 · Disguise control
`DisguiseHandler.undisguise(profile, …)`, `getAllDisguisedProfiles()` — see who is
disguised and drop it.

### A11 · Notifications — **not built**
Same gap: `saveNotification` takes an `INotification` the API will not construct.
`INotificationHandler.saveNotification(…)` — a message that waits for a player
rather than needing them online, unlike A-side messaging.

### A12 · Console runner
Dispatch any command as console on a chosen server. The honest escape hatch: it
covers every feature not listed here and every one Phoenix adds later. Gated to
Management, every command audited. **High power — build it last and carefully.**

### A13 · Live player list
Who is on right now and on which server, from the published server rows plus
`INetworkHandler.getOnlinePlayers(server)`.

---

## Phase B — Discord

**Status: B1, B3 and B5 done and deployed.** All of this runs through
`discord_tasks` and the bot.

- **B1 · Post to a channel** — a message or a proper embed, from the panel.
- **B2 · Members** — *partly done.* The Users tab lists everyone who has signed
  in, with their roles and linked account. A full guild member list (including
  people who have never used the site) needs the bot to publish one, the way
  ServerPublisher does for servers.
- **B3 · Moderate** — kick, ban, timeout a Discord member.
- **B4 · Announcements** — *next.* Both halves exist now (Broadcast for the game,
  Discord for the channel); this is one composer over the two.
- **B5 · Link management** — see and break account links from the panel.
- **B6 · Ticket/appeal bridge** — if appeals still arrive in Discord, pull them
  into the same queue as the website's.

---

## Phase C — the panel itself

- **C1 · Search everything** — one box across players, reports, ranks, logs.
- **C2 · Saved views** — "open reports on Bedwars this week" as a link.
- **C3 · Scheduled actions** — an unban that happens on Friday, a restart nightly.
- **C4 · Export** — the audit and the logs, out, for keeping.

---

## What is genuinely not possible

Stated plainly so nobody plans around it:

- **A brand-new ladder rung.** The API hands out rungs but constructs none, and
  the concrete class is inside the obfuscated core. Existing rungs edit fine.
  *(Permissions had the same problem and were solved by reflection — a rung could
  follow the same route if it ever matters enough.)*
- **A player's inventory.** Nothing in `pxAPI` exposes it. It would need our own
  plugin to serialise and publish it — possible, but bespoke work, not an API call.
- **Anything the proxy owns that Phoenix does not surface.** Moving a player works
  because the proxy accepts `Connect`; there is no equivalent for most proxy state.
- **Live server state without the plugin.** None of it is in any database. If the
  plugin is not deployed, the panel cannot know and says so rather than guessing.

---

## The rule this all follows

Every one of these either goes through the core's own API or is honest that it
did not. The panel never writes something the game will not see and then reports
success — if a job cannot reach the network it says so, and if a server refuses
it, it says what the server said.
