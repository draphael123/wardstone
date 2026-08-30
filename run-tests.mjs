import { runTests } from './src/harness.js';
const r = runTests(console.log);
process.exit(r.fail ? 1 : 0);
