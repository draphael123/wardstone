// One process per configuration. The previous version cache-busted its imports
// with ?v=, which gave it a DIFFERENT arena module instance than sim.js held —
// so setMap() had no effect on the world being simulated and every "gauntlet"
// number was really the glade measured twice.
import { World } from './src/sim.js';
import { Bot } from './src/harness.js';
import { setMap } from './src/arena.js';
const map = process.argv[2] || 'glade';
const N = Number(process.argv[3] || 21);
setMap(map);
const DT = 1/60;
let won = 0;
for (let seed = 1; seed <= N; seed++) {
  const w = new World({ seed });
  const bot = new Bot(w, { build: true, fight: true });
  while (w.phase !== 'won' && w.phase !== 'lost' && w.t < 900) { bot.tick(DT); w.step(DT); }
  if (w.phase === 'won') won++;
}
console.log(`${map} ${won}/${N}`);
