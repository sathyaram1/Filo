// Il driver che git lancia sul registro delle novità (.gitattributes, merge=novita): `%O %A %B %L`. La config la scrive
// scripts/lib/prepara-copia.mjs. Regole: scripts/lib/driver-novita.mjs; sentinella: tests/unit/driverNovita.test.mjs.

import { driver } from './lib/driver-novita.mjs';

const [base, ours, theirs, marcatori] = process.argv.slice(2);
if (!base || !ours || !theirs) {
  process.stderr.write('Uso: node scripts/novita-driver.mjs <base> <ours> <theirs> [marcatori]\n');
  process.exit(2);
}
process.exit(driver({ base, ours, theirs, marcatori }));
