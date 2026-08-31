// WARDSTONE — the numbers.
//
// Everything tunable lives here so the harness reads the same values the game
// runs on. No imports, no logic: if a rule needs a branch it belongs in sim.js,
// and if it needs a mesh it belongs in render.js.
//
// The premise this file has to serve: YOUR WARDS HOLD THE LANES, YOU HOLD WHAT
// THE LANES DON'T COVER. Two numbers carry that and must not drift:
//
//   * BREAKER dps against a blockade (59) EXCEEDS the player's repair rate (45).
//     A breaker cannot be out-repaired, so it cannot be walled — it has to be
//     killed. Raise repair above 59 and the player becomes a spectator again.
//   * Only the BRAZIER can hit a flier, and it is the weakest ward in the set.
//     Wisps are the player's problem by construction, not by tuning. Give any
//     other ward `targets: 'all'` and that gap closes.
//   * ECON.duBudget caps how much board the wards may cover AT ALL. Without it
//     both gaps above close by sheer volume — see the note on it below.

export const PLAYER = {
  hp: 100,
  speed: 9.0,          // m/s — DD is fast; slower and the courier job drags
  radius: 0.6,
  respawn: 5.0,        // s, back at the wardstone

  // Two weapons, swapped freely. This is what makes "you hold what the lanes
  // don't cover" a moment-to-moment decision instead of a standing fact: the
  // sword is far stronger but cannot reach a wisp and puts you inside the
  // brawl, where things hit back.
  //
  // The crossbow's dps is deliberately IDENTICAL to the old single weapon
  // (62), so the air fight — the load-bearing gap — is mathematically
  // unchanged and the whole balance sweep stays valid. Only the ground
  // option is new.
  weapons: {
    crossbow: {
      name: 'Crossbow', kind: 'ranged', targets: 'all',
      damage: 34, cooldown: 0.55,      // 62 dps on the ground
      // and half as much again against anything airborne. Total anti-air in
      // the game is roughly unchanged; what moves is WHO provides it. Simply
      // nerfing the watchtower made the air leak and the run unwinnable —
      // the capacity has to go somewhere, and the premise says it goes here.
      airMul: 1.6,
      speed: 62, radius: 0.9, range: 34,
    },
    // THE SWORD — rebuilt as a moveset rather than a single repeated swing.
    //
    // The report was that all four halves of it were wrong at once: slow to
    // start, no weight in the blow, no way to tell whether it connected, and
    // only ever one move. So the fix is not a number, it is a shape:
    //
    //   light 1-2-3   a chain. Each link starts FASTER than the old single
    //                 swing (0.07s against 0.36s of cooldown-gated nothing),
    //                 gets wider as it goes, and the third is a finisher with
    //                 real damage and a step into it.
    //   heavy         held. Slow, committed, and the only thing in the game
    //                 that staggers a POISED foe — which is what gives the
    //                 Bruiser and the Breaker an answer other than running.
    //
    // Attacks ROOT you for their active frames. That is what makes a heavy
    // weapon read as heavy rather than as laggy: the cost is your feet, not
    // your reaction time. The roll is the way out.
    sword: {
      name: 'Sword', kind: 'melee', targets: 'ground',
      // kept so anything reading weapon.damage/range/cooldown still works
      damage: 36, cooldown: 0.36, range: 2.8, arc: 1.9,
      // How long a swing may be followed up. Too short and the chain feels
      // like it drops inputs; too long and it fires when you have stopped.
      // The chain's sustained damage is held at the OLD single swing's 100 dps
      // on purpose: the rework is about feel, and letting it also be a damage
      // buff would have made every balance number in the suite unreadable.
      chainWindow: 0.52,
      chain: [
        // startup: time before the blade lands. The FIRST one is the whole
        // "too slow to start" complaint and is deliberately the shortest.
        { startup: 0.07, active: 0.10, recover: 0.16, damage: 31, arc: 1.7, range: 2.8, lunge: 0.35 },
        { startup: 0.09, active: 0.10, recover: 0.18, damage: 36, arc: 2.0, range: 2.9, lunge: 0.45 },
        { startup: 0.15, active: 0.14, recover: 0.34, damage: 65, arc: 2.6, range: 3.2, lunge: 0.95 },
      ],
      heavy: {
        charge: 0.34,        // s held before it is a heavy at all
        startup: 0.22,
        active: 0.16,
        recover: 0.42,
        damage: 96,
        arc: 2.3,
        range: 3.4,
        lunge: 1.3,
        breaksPoise: true,   // the ONLY thing that staggers a Bruiser
      },
    },
  },
  // Blocking. Only with the sword — you cannot hold a shield up behind a
  // crossbow — which gives the swap a second reason to exist beyond reach.
  // Blocking costs MANA — the same currency you build with. There is no stamina
  // bar in this game by choice, and inventing a guard meter would be stamina
  // wearing a hat. Draining the build purse instead means turtling has a real
  // price that is legible without a new UI element: hold the shield up all
  // fight and you cannot afford the wall that would have done the job for you.
  block: {
    manaPerSec: 22,    // drained while braced; blocking stops when it runs dry
    reduce: 0.22,      // damage taken multiplier while braced
    slow: 0.42,        // movement multiplier
  },

  swapTime: 0.22,      // brief lockout so swapping mid-brawl is a real choice
  // Jump. The apex is chosen from ONE requirement: the sword must reach a
  // will-o-wisp at the top of it, and must not reach one from the ground.
  // Wisp altitude 4.2m, the blade tops out about 2.5m above the player's feet,
  // so the apex has to clear ~1.9m. h = v^2/2g, so v = sqrt(2*18*2.1) ~ 8.7.
  jump: {
    speed: 8.7,        // m/s upward at takeoff
    gravity: 18,       // m/s^2 — brisk, so the hang time stays readable
    // How far above the blade's arc a flier can still be caught. Tightened
    // from 1.2: with the blade topping out at 2.5m from the ground, 1.2 gave
    // a 3.7m ceiling — which made a DIVING wisp hittable while standing
    // still, and the jump went back to being decorative. At 0.5 the ground
    // ceiling is 3.0m, below the 3.4m a wisp dives to, so the dive can only
    // be answered in the air.
    airReach: 0.5,
    cooldown: 0.12,    // just enough to stop a held key machine-gunning it
  },
  aimCone: 0.978,      // cos(12deg) — assist snaps to a foe inside this cone
  aimConeAir: 0.62,    // cos(52deg) — fliers, which sit well above a flat aim

  // A dodge on a plain cooldown. No stamina: the cost is the cooldown and the
  // fact that it commits you to a direction for a fifth of a second.
  dodge: {
    speed: 27,         // m/s during the roll
    time: 0.20,        // how long the roll lasts
    cooldown: 1.15,
    iframes: 0.24,     // slightly longer than the roll, so it covers the recovery
  },

  repairRate: 45,      // hp/s  (deliberately BELOW BREAKER_DPS, see above)
  repairCostPerHp: 0.12,
  repairRange: 3.4,

  pickupRange: 6.0,    // motes must be walked over — this IS the courier job.
                       // Wide enough that walking a lane sweeps it; narrow
                       // enough that you cannot sweep three lanes at once.
  vacuumSpeed: 14,
};

// Warming yourself at the fire. Only between waves, only close to it — which
// gives the objective a second job (it is the only way to heal) and gives the
// muster a reason to end at the hearth rather than wherever you last fought.
export const HEARTH = {
  radius: 7.0,
  heal: 14,          // hp per second
};

export const WARDSTONE = {
  hp: 3000,
  radius: 3.4,         // plinth footprint; nothing may be built inside it
  guardRadius: 0.6,    // clearance BEYOND the plinth before striking
};

// How a foe reacts to being hit by the player.
//
// Attacking something makes it YOURS. It leaves its lane and comes for you,
// which turns baiting a heavy off a wall into a real tactic rather than a
// thing you would expect to work and find you cannot.
//
// The leash is what stops that becoming a way to trivialise the lanes: a foe
// pulled more than `leash` metres from where it left the lane gives up and
// goes back. So you can peel one or two off and fight them on your terms, but
// you cannot walk backwards and drag an entire wave into a corner.
//
// On the numbers: chasing costs about two wins in twenty-one at ANY leash
// between 12m and 22m — the length barely matters, the chasing does. That
// figure is an UPPER bound on the real cost, because the harness bot only ever
// SUFFERS this mechanic: it has no policy for baiting a breaker off a wall, so
// it experiences the downside and never once uses the upside.
// See [[sim-cannot-measure-a-strategy-the-bot-cannot-play]].
// Getting hit has to CHANGE what a foe is doing, or combat reads as swinging at
// scenery. But it must not change it every single time: if every blow staggers,
// mashing beats blocking and rolling, and the defensive half of the game stops
// existing. See [[hyperarmour-stops-mashing]].
//
// So: light foes stagger, on a per-foe COOLDOWN, and only from the player —
// a ward that staggered would perma-lock a lane for free. Heavies have poise
// and never stagger at all; their long readable windups are answered by moving,
// not by out-damaging them.
export const STAGGER = {
  time: 0.32,       // s of interrupted, staggered-back reaction
  cooldown: 1.15,   // s before the same foe can be staggered again
  // Small. Swept over 21 seeds on both maps: a 0.55m shove costs real ground
  // because the foe has to walk back into reach and the player follows it.
  // 0.2m still reads as a jolt without turning every fight into a chase.
  knock: 0.2,       // m shoved away from the blow
  minDamage: 12,    // a graze does not stagger anything
};

export const AGGRO = {
  time: 3.2,        // s of interest after you hurt it, for the telegraph
  leash: 14,        // m from its lane position before it gives up and returns
  chaseTime: 4.0,   // s it will pursue after the last hit
  windup: 0.42,     // s of visible telegraph before a strike lands
};

// Upgrading in place, rather than a fifth ward. Units stay FIXED and power
// goes up, which makes the unit budget bite harder as the game goes on: late
// mana has somewhere to go that does not widen your coverage.
export const UPGRADE = {
  maxLevel: 3,
  costMul: 1.15,     // x the ward's base cost, per level bought
  power: 1.45,       // damage and hit points per level
  time: 2.2,         // build time for an upgrade, in combat
};

// The knight's one ability: a horn. It is a PANIC BUTTON, deliberately —
// the pressure this game creates is "the wall is about to go and two things
// need me at once", and an ability that does not answer that moment is just
// another damage button.
export const ABILITY = {
  id: 'rally', name: 'Rally',
  cooldown: 24,
  radius: 10,        // foes staggered
  stun: 1.4,
  knock: 2.2,        // metres shoved back
  wardRadius: 13,
  wardBuff: 1.7,     // rate multiplier on nearby wards
  buffTime: 7,
};

// Breakable caches, scattered each muster. Dungeon Defenders' first map does
// this with mana chests and it does three jobs at once: it gives the build
// phase an ACTIVITY instead of "place things, press R", it teaches you the
// layout while nothing is chasing you, and it makes starting mana earned
// rather than granted.
//
// They respawn every muster rather than being one-time, because a one-time
// scatter only gives wave one a job and this game has six.
export const CACHE = {
  count: 7,          // per muster
  hp: 40,
  value: 26,         // mana, dropped as motes you still have to walk over
  minLaneDist: 5.0,  // never in the road
  minFromFire: 11,   // far enough that you must actually go and look
  maxFromFire: 31,
};

// ---------------------------------------------------------------------------
// Difficulty.
//
// The shipped curve is tuned so a near-optimal bot wins 8-9 of 10 with the fire
// around a third remaining. A human's FIRST run is a different game, and one
// curve makes "too hard or too easy" a coin flip per player.
//
// TWO dials, and one deliberately left alone:
//   hp     — how long a foe survives, so how much the body is worth
//   count  — how many arrive, so how much the WARDS are worth
//   du     — NOT a difficulty dial. It is the premise dial. 32 is the swept
//            value; 36 is the measured cliff where a ward build wins with
//            nobody playing. Every tier keeps 32, so no setting can turn this
//            into a game that plays itself, and the tiers cannot drift the one
//            number the whole design rests on.
//
// An honest note on how far these are verified. The bot builds from a FIXED
// shopping list sized for 32 units, so it cannot re-plan around a changed
// budget or a changed kill-rate: measured, du 32->30 alone takes the glade
// from 8/10 to 0/10, and +10% foe hp does the same. That is the pilot falling
// off a cliff, not the game. So the tier NUMBERS are for humans and are not
// claimed to be bot-tuned. What IS asserted per tier, and tested:
//   * the premise holds at every tier — no idle ward build wins (T24)
//   * the tiers are correctly ORDERED by how much fire survives (T25)
// See [[sim-cannot-measure-a-strategy-the-bot-cannot-play]].
// ---------------------------------------------------------------------------
export const DIFFICULTY = {
  squire: {
    id: 'squire', name: 'Squire', hp: 0.80, count: 0.85, du: 32,
    blurb: 'Fewer of them, and they die faster. The same board to hold.',
  },
  knight: {
    id: 'knight', name: 'Knight', hp: 1, count: 1, du: 32,
    blurb: 'The curve everything was balanced against. Start here.',
  },
  warden: {
    id: 'warden', name: 'Warden', hp: 1.04, count: 1.20, du: 32,
    blurb: 'More of them, and each one takes longer to put down.',
  },
};

export const ECON = {
  // THE most load-bearing number in the game. Mana is a flow; DU is a HARD CAP
  // on how much board you may cover at once, and it is the reason the body has
  // a job at all. With no cap, a full ward build wins with the player stood
  // still in a corner — the documented way this genre dies.
  //
  // Swept, both arms, 7 seeds (.dbg/sweep.mjs):
  //     du   idle build wins?   body wins   median stone
  //     26   no                 2/7         0        <- too swingy
  //     30   no                 5/7         212
  //     32   NO                 7/7         1556     <- chosen
  //     34   no                 7/7         1556
  //     36   YES (balanced)     7/7         2670     <- premise breaks here
  // The usable window is 32-34. 32 sits two steps clear of the cliff at 36.
  duBudget: 32,
  startMana: 260,
  buildPhase: 40,      // s before wave 1
  interPhase: 30,      // s between waves
  manaCap: 1200,
};

// ---------------------------------------------------------------------------
// Wards. Four behaviours cover the whole set:
//   blockade   — no damage, pure HP, stops the lane
//   projectile — single target, travels, ground only
//   aura       — persistent field, no targeting, hits EVERYTHING incl. fliers
//   trap       — proximity trigger, one big AoE, then recharges, ground only
// ---------------------------------------------------------------------------
// CUT BACK TO TWO, deliberately.
//
// The Watchtower and Caltrops are parked, not deleted — their definitions are in
// git and the aura/field/anti-air code is untouched. Four wards were being
// balanced against each other before the two that carry the game were right.
//
// Two consequences, both load-bearing:
//   * There is NO anti-air ward at all. The sky is entirely the player's.
//   * There is no AURA left, so the ballista had to become the crowd answer as
//     well as the elite answer — which is what `pierce` is for. Measured: with
//     two wards and no pierce, the game is unwinnable at ANY ballista strength,
//     including one 60% stronger than the old one (4/21 on the glade, 0/21 on
//     the gauntlet). Single-target damage cannot hold a hundred foes a wave.
export const WARDS = [
  {
    id: 'palisade', name: 'Palisade', key: '1', kind: 'blockade',
    cost: 35, du: 1, hp: 2200, buildTime: 2.5, unlockWave: 0, radius: 0.95, targets: 'none',
    blurb: 'Holds a lane. Deals nothing. Foes stop and hit it.',
  },
  {
    id: 'ballista', name: 'Ballista', key: '2', kind: 'projectile',
    cost: 70, du: 4, hp: 300, buildTime: 4.0, unlockWave: 1, radius: 0.8, targets: 'ground',
    // Same sustained damage as before, delivered as rare HEAVY blows at long
    // reach. That makes it the answer to one big thing rather than a second
    // way to grind down a crowd, which is what made it blur with the tower.
    // Rebuilt around its UPGRADE CURVE rather than its base numbers, and given
    // a bolt that PUNCHES THROUGH a rank rather than stopping at the first body.
    //
    // At 30m / 96 damage / 2.4s it was 40 dps across most of the map from the
    // moment you could afford one, so the first ballista answered everything
    // and the upgrade was an afterthought. It now starts at about a fifth of
    // that and grows into it.
    //
    // Pierce is what replaces the parked Watchtower's aura, and it is a better
    // fit than a splash: the ballista's area is a LINE, so a gun laid along a
    // lane cuts a whole file and one laid across it hits one goblin. Where you
    // point it is the decision.
    range: 20, damage: 61, cooldown: 3.4, projSpeed: 58, projRadius: 0.8,
    pierce: 3,
    up: { power: 1.39, rate: 0.88, range: 1.225, pierce: 1 },
    blurb: 'A heavy bolt that punches through a rank. Short and slow until you invest.',
  },
  {
    id: 'archers', name: 'Watchtower', key: '3', kind: 'aura',
    cost: 60, du: 4, hp: 260, buildTime: 3.5, radius: 0.8, targets: 'all',
    range: 8.5, dps: 26, unlockWave: 2,
    // It can shoot upward; it is BAD at it. "Only one ward reaches a flier"
    // stopped being enough once you could ring the hearth with them, because
    // every wisp converges there — measured, the player's share of the air had
    // fallen to 39%, i.e. no specialisation at all. Loosing at something in
    // the sky is hard, so it lands 40% of its damage there and the body still
    // has to finish the job.
    airMul: 0.55,
    // A dead zone directly overhead. An archer on a platform cannot shoot
    // straight up, and structurally this is what stops a tight RING of towers
    // around the fire from being a complete answer to the air: every wisp
    // converges on the hearth, so towers hugging it were covering the one
    // place they should not be able to. Catch them on the approach or not at
    // all. Tuning the stacking falloff twice did not fix this; geometry does.
    minAir: 4.0,
    blurb: 'Loose and steady at everything nearby. The only ward that can shoot upward.',
  },
];

// Wards go up INSTANTLY while the doors are shut and take real seconds once a
// wave is running. That is what stops "rebuild the wall mid-breaker" from
// being free, and it makes the muster phase worth its length.
export const BUILD_INSTANT_IN_MUSTER = true;

// Wards arrive WITH the problem they answer, not all at once: the Archer Post
// unlocks for wave 3, which is the wave will-o-wisps first appear, and the
// Deadfall for wave 4, which is the first Troll. A player handed four tools on
// turn one learns none of them.
export const WARD_BY_ID = Object.fromEntries(WARDS.map(w => [w.id, w]));

// ---------------------------------------------------------------------------
// Foes. Each exists to attack a different assumption:
// `damage` is SIEGE damage (wards and the stone). `playerDamage` is what it
// does to a body. They are separate because a breaker has to threaten a wall
// far harder than it threatens you — one number for both either makes the
// breaker unable to break anything, or makes it one-shot the player.
//
//   husk    — the baseline the lanes are built for
//   runner  — volume; punishes a lane held by one thin ward
//   wisp    — ignores lanes AND blockades entirely      (the player's job)
//   breaker — out-damages repair, so a wall only buys time (the player's job)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The goblins.
//
// The rule this list is built on: a new foe must demand a DEFENSIVE VERB that
// nothing else demands. Variety for its own sake makes a longer list, not a
// harder game. See [[enemy-design-fill-gaps-not-variety]].
//
//   Cutter    the baseline. Walks up and hits the nearest thing.
//   Runner    fast, cheap, arrives in a clump  -> intercept early
//   Wisp      flies over every wall you own    -> YOUR job, not a ward's
//   Maul      wrecks blockades specifically    -> do not defend with walls alone
//   Slinger   stops short and SHOOTS           -> go and kill it yourself
//   Powder    detonates on your line           -> kill before contact, don't cluster
//   Bruiser   one enormous, slow, readable blow-> interrupt it or get out of the way
//   Breaker   out-damages your hammer          -> a wall only buys time
// ---------------------------------------------------------------------------
export const FOES = [
  {
    id: 'husk', name: 'Cutter',
    hp: 120, speed: 3.0, radius: 0.55, bounty: 8,
    damage: 22, playerDamage: 12, attackCd: 1.2, flying: false, height: 1.7,
  },
  {
    id: 'runner', name: 'Runner',
    hp: 55, speed: 6.2, radius: 0.45, bounty: 5,
    damage: 10, playerDamage: 7, attackCd: 0.7, flying: false, height: 1.4,
  },
  {
    id: 'wisp', name: 'Wisp',
    hp: 52, speed: 4.4, radius: 0.5, bounty: 12,
    damage: 10, playerDamage: 9, attackCd: 1.0, flying: true, height: 1.1, flyHeight: 4.2,
    // how low it comes to actually strike the fire — inside a jumping
    // sword's reach, which is the whole point of it
    diveHeight: 3.4,
  },
  {
    // The answer to "I will just wall the lane". A maul does ordinary damage to
    // you and MORE THAN TRIPLE to a blockade, so a line of palisades with
    // nothing behind it is a delaying action rather than a defence. It is
    // deliberately fragile: the counter is to kill it, not to out-build it.
    id: 'maul', name: 'Maul Goblin',
    hp: 150, speed: 2.5, radius: 0.62, bounty: 11,
    damage: 34, playerDamage: 15, attackCd: 1.7, flying: false, height: 1.8,
    siegeMul: 3.4,          // multiplier applied ONLY against blockades
  },
  {
    // The genuinely new SHAPE. Everything else has to reach a thing to hurt it,
    // which is what makes a wall a wall. A slinger stops short and shoots over
    // it — so a blockade stops its MOVEMENT and not its DAMAGE, and the lane
    // holds while the wall dies anyway.
    //
    // The counter is the premise stated as a foe: go and kill it yourself, or
    // put something behind the wall that outranges it. The ballista reaches
    // 30m precisely so it can answer this; the slinger reaches 11.
    // Tuned down hard from where it started. Swept over 21 seeds: its stand-off
    // RANGE barely moves the result (11m to 6.5m was 3/10 to 4/10) but its
    // damage moves it enormously, because a slinger never spends time walking
    // into reach and never dies to a ward on the way in — it simply fires,
    // forever, at full uptime. Damage per second is the whole dial.
    id: 'slinger', name: 'Slinger',
    hp: 80, speed: 3.4, radius: 0.48, bounty: 13,
    damage: 18, playerDamage: 11, attackCd: 2.1, flying: false, height: 1.6,
    ranged: { range: 7, speed: 22, radius: 0.42 },
  },
  {
    id: 'bomber', name: 'Powder Goblin',
    hp: 70, speed: 5.4, radius: 0.5, bounty: 14,
    damage: 0, playerDamage: 0, attackCd: 1.0, flying: false, height: 1.3,
    // it ignores the fire entirely and goes for whatever you built
    seeksWards: true,
    blast: { radius: 4.2, ward: 520, player: 30, stone: 260, fuse: 0.55 },
  },
  {
    // A two-handed blow with a windup twice as long as anything else. It hits
    // hard enough to matter and slowly enough to answer, which is the point:
    // it is the foe Rally and the dodge roll exist for. Kill it, stagger it, or
    // step out of the arc — but do not stand in front of it and trade.
    poise: true,          // never staggered — dodge it, do not trade with it
    id: 'bruiser', name: 'Bruiser',
    hp: 340, speed: 2.2, radius: 0.8, bounty: 22,
    damage: 60, playerDamage: 42, attackCd: 2.6, flying: false, height: 2.3,
    windup: 0.95,           // overrides AGGRO.windup — the tell is the defence
  },
  {
    poise: true,          // never staggered — a wall buys the time, not your sword
    id: 'breaker', name: 'Breaker',
    hp: 1200, speed: 1.9, radius: 1.15, bounty: 40,
    damage: 320, playerDamage: 26, attackCd: 2.2, flying: false, height: 3.0,
  },
];

export const FOE_BY_ID = Object.fromEntries(FOES.map(f => [f.id, f]));

// The number PLAYER.repairRate must stay under. Asserted in the harness.
export const BREAKER_DPS = FOE_BY_ID.breaker.damage / FOE_BY_ID.breaker.attackCd;

// ---------------------------------------------------------------------------
// Waves. `at` is seconds from the start of the wave, so a group can trail
// another down the same lane. Six waves, each introducing exactly one idea.
// ---------------------------------------------------------------------------
export const WAVES = [
  { // 1 — two lanes, one foe. Learn: lanes, palisade, ballista.
    name: 'The First Knock',
    groups: [
      { lane: 'north', foe: 'husk', count: 6, at: 0.0, gap: 1.4 },
      { lane: 'east',  foe: 'husk', count: 6, at: 3.0, gap: 1.4 },
    ],
  },
  { // 2 — all three lanes open; runners add volume; the first MAUL, which is
    // the wave that says a wall on its own is a delaying action.
    name: 'Three Doors',
    groups: [
      { lane: 'north', foe: 'husk',   count: 8,  at: 0.0, gap: 1.2 },
      { lane: 'east',  foe: 'runner', count: 10, at: 2.0, gap: 0.7 },
      { lane: 'west',  foe: 'husk',   count: 6,  at: 1.0, gap: 1.2 },
      { lane: 'west',  foe: 'maul',   count: 2,  at: 6.0, gap: 2.2 },
    ],
  },
  { // 3 — WISPS. For part of this wave the lanes stop meaning anything.
    name: 'Nothing Walks',
    groups: [
      { lane: 'north', foe: 'husk',   count: 8,  at: 0.0, gap: 1.1 },
      { lane: 'west',  foe: 'runner', count: 12, at: 1.5, gap: 0.6 },
      { lane: 'east',  foe: 'bomber', count: 2,  at: 4.0, gap: 2.4 },
      { lane: 'north', foe: 'slinger', count: 3, at: 8.0, gap: 2.0 },
      { lane: 'north', foe: 'wisp',   count: 5,  at: 6.0, gap: 1.8 },
      { lane: 'east',  foe: 'wisp',   count: 5,  at: 10.0, gap: 1.8 },
    ],
  },
  { // 4 — the first BREAKER. A wall stops buying safety and starts buying time.
    name: 'Something Heavy',
    groups: [
      { lane: 'east',  foe: 'husk',    count: 12, at: 0.0,  gap: 0.9 },
      { lane: 'west',  foe: 'runner',  count: 14, at: 1.0,  gap: 0.55 },
      { lane: 'north', foe: 'breaker', count: 1,  at: 4.0,  gap: 0 },
      { lane: 'east',  foe: 'maul',    count: 3,  at: 6.0,  gap: 1.8 },
      { lane: 'north', foe: 'slinger', count: 4,  at: 8.0,  gap: 1.6 },
      { lane: 'west',  foe: 'bomber',  count: 3,  at: 7.0,  gap: 1.8 },
      { lane: 'north', foe: 'husk',    count: 10, at: 5.0,  gap: 1.0 },
      { lane: 'east',  foe: 'wisp',    count: 6,  at: 11.0, gap: 1.4 },
      { lane: 'west',  foe: 'wisp',    count: 4,  at: 16.0, gap: 1.5 },
    ],
  },
  { // 5 — two pressures at once, on lanes deliberately far apart.
    name: 'Both Hands Full',
    groups: [
      { lane: 'north', foe: 'runner',  count: 20, at: 0.0,  gap: 0.42 },
      { lane: 'west',  foe: 'breaker', count: 1,  at: 2.0,  gap: 0 },
      { lane: 'east',  foe: 'breaker', count: 1,  at: 9.0,  gap: 0 },
      { lane: 'north', foe: 'bomber',  count: 4,  at: 5.0,  gap: 1.5 },
      { lane: 'east',  foe: 'bruiser', count: 2,  at: 4.0,  gap: 3.0 },
      { lane: 'west',  foe: 'slinger', count: 4,  at: 7.0,  gap: 1.5 },
      { lane: 'east',  foe: 'husk',    count: 14, at: 3.0,  gap: 0.8 },
      { lane: 'west',  foe: 'husk',    count: 12, at: 6.0,  gap: 0.9 },
      { lane: 'north', foe: 'wisp',    count: 9,  at: 9.0,  gap: 1.1 },
      { lane: 'east',  foe: 'wisp',    count: 4,  at: 15.0, gap: 1.3 },
    ],
  },
  // NOTE on tuning the finale: a FOURTH breaker here reads as a small change
  // on the glade (8/10 wins) and swings the gauntlet to 3/10 every time — its
  // two 36m lanes cannot absorb heavies the way three 38m ones can. Breaker
  // count is the most map-sensitive dial in the game; reach for volume or air
  // first, and re-run .dbg/diff2.mjs on BOTH maps after touching it.
  { // 6 — everything, on every lane.
    name: 'The Long Dark',
    groups: [
      { lane: 'north', foe: 'runner',  count: 22, at: 0.0,  gap: 0.40 },
      { lane: 'east',  foe: 'runner',  count: 22, at: 0.5,  gap: 0.40 },
      { lane: 'west',  foe: 'breaker', count: 1,  at: 2.0,  gap: 0 },
      { lane: 'north', foe: 'breaker', count: 1,  at: 8.0,  gap: 0 },
      { lane: 'east',  foe: 'breaker', count: 1,  at: 15.0, gap: 0 },
      { lane: 'west',  foe: 'bomber',  count: 5,  at: 4.0,  gap: 1.3 },
      { lane: 'east',  foe: 'bomber',  count: 5,  at: 12.0, gap: 1.3 },
      { lane: 'east',  foe: 'husk',    count: 14, at: 5.0,  gap: 0.72 },
      { lane: 'west',  foe: 'husk',    count: 14, at: 6.0,  gap: 0.72 },
      { lane: 'north', foe: 'maul',    count: 4,  at: 7.0,  gap: 1.6 },
      { lane: 'west',  foe: 'slinger', count: 5,  at: 9.0,  gap: 1.4 },
      { lane: 'east',  foe: 'bruiser', count: 3,  at: 11.0, gap: 2.6 },
      { lane: 'west',  foe: 'wisp',    count: 6,  at: 10.0, gap: 1.2 },
      { lane: 'north', foe: 'wisp',    count: 6,  at: 15.0, gap: 1.2 },
      { lane: 'east',  foe: 'wisp',    count: 6,  at: 20.0, gap: 1.2 },
    ],
  },
];

// What is coming, per track, for a given wave — the thing a player needs
// before deciding where to spend units, and which was previously only
// discoverable by being wrong once.
export function waveByLane(w) {
  const out = {};
  if (!w) return out;
  for (const g of w.groups) {
    const L = out[g.lane] || (out[g.lane] = { total: 0, kinds: {} });
    L.total += g.count;
    L.kinds[g.foe] = (L.kinds[g.foe] || 0) + g.count;
  }
  return out;
}

export function waveFoeCount(w) {
  return w.groups.reduce((n, g) => n + g.count, 0);
}
