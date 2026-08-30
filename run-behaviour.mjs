import { runBehaviour } from './src/behaviour.js';
const r = runBehaviour();
process.exit(r.bad ? 1 : 0);
