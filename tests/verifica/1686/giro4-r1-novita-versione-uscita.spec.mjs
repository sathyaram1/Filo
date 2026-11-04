// Verifica #1686 giro 4: le righe di Novità del pacchetto stanno sotto una versione già pubblicata (la 0.2.257),
// quindi chi aggiorna non le vede. La 0.2.262 era l'ultima uscita quando è stata scritta questa critica.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ULTIMA_USCITA = '0.2.262';

test('r1 le righe del pacchetto stanno nel blocco di una versione non ancora uscita', () => {
  require(join(ROOT, 'src', 'shared', 'patchNotes.js'));
  const PN = globalThis.SN_PATCH_NOTES;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const num of [1397, 884, 413, 823, 1626]) {
    const blocco = PN.NOTES.find((n) => [...(n.features || []), ...(n.fixes || [])].some((r) => r && r.segnalazione === num));
    expect(blocco, `riga di #${num}`).toBeTruthy();
    expect(PN.cmpVersion(blocco.version, ULTIMA_USCITA), `#${num} sotto ${blocco.version}`).toBeGreaterThan(0);
    expect(PN.cmpVersion(blocco.version, pkg.version), `#${num} sotto ${blocco.version}, app ${pkg.version}`).toBeGreaterThan(0);
  }
});
