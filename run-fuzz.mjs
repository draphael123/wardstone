import { runFuzz } from './src/fuzz.js';
const r = runFuzz(console.log);
process.exit(r.fails ? 1 : 0);
