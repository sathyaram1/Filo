// Il driver che git lancia sul registro delle novità (.gitattributes, merge=novita): `%O %A %B %L`, oppure `--imposta`
// per scriverlo nella config del repo. Regole: scripts/lib/driver-novita.mjs; sentinella: tests/unit/driverNovita.test.mjs.

import { driver, ensureDriverNovita } from './lib/driver-novita.mjs';

const args = process.argv.slice(2);
if (args[0] === '--imposta') {
  const r = ensureDriverNovita(process.cwd());
  if (!r.ok) process.stderr.write(`driver delle novità non impostato: ${r.why}\n`);
  process.exit(r.ok ? 0 : 1);
}
const [base, ours, theirs, marcatori] = args;
if (!base || !ours || !theirs) {
  process.stderr.write('Uso: node scripts/novita-driver.mjs <base> <ours> <theirs> [marcatori] | --imposta\n');
  process.exit(2);
}
process.exit(driver({ base, ours, theirs, marcatori }));
