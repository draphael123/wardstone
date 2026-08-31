// One process per configuration. The previous version cache-busted its imports
// with ?v=, which gave it a DIFFERENT arena module instance than sim.js held —
// so setMap() had no effect on the world being simulated and every "gauntlet"
// number was really the glade measured twice.
import { World } from './src/sim.js';
import { Bot } from './src/harness.js';
import { setMap } from './src/arena.js';
const map = process.argv[2] || 'glade';
// The SAME seeds T22 uses. Using 1..21 instead made this disagree with the
// authoritative test by about four wins every time, and I tuned against it
// three separate times before noticing.
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 7, 11, 17, 23, 29,
               37, 41, 43, 47, 53, 59];
setMap(map);
const DT = 1/60;
let won = 0;
for (const seed of SEEDS) {
  const w = new World({ seed });
  const bot = new Bot(w, { build: true, fight: true });
  while (w.phase !== 'won' && w.phase !== 'lost' && w.t < 900) { bot.tick(DT); w.step(DT); }
  if (w.phase === 'won') won++;
}
console.log(`${map} ${won}/${SEEDS.length}`);
