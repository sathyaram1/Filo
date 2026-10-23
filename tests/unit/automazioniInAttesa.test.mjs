// Una copia in attesa in routines/automazioni prende il posto dell'attiva omonima così com'è (#1140): se intanto
// l'attiva cambia, lo spostamento cancella quella modifica senza dirlo. Qui l'impronta dell'attiva su cui la copia è nata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTIVI, IN_ATTESA, nomiYaml } from '../helpers/workflowInVigore.mjs';

// Nome → SHA-256 dell'attiva (fine riga LF) quando la copia è stata preparata. Spostata la copia, la voce si toglie.
const BASI = {
  'release.yml': 'de0a302efb19e1e14aa623a4e897c35d7059811c46033439ba5e2d796e0365ba',
};

const impronta = (p) => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('ogni copia in attesa che sostituisce un workflow attivo è nata sull\'attiva di adesso', () => {
  for (const nome of nomiYaml(IN_ATTESA).filter((n) => existsSync(join(ATTIVI, n)))) {
    assert.ok(BASI[nome], `routines/automazioni/${nome} sostituisce .github/workflows/${nome}: registra in BASI l'impronta dell'attiva su cui è nata`);
    assert.equal(impronta(join(ATTIVI, nome)), BASI[nome],
      `.github/workflows/${nome} è cambiato dopo che è nata la copia in attesa: spostandola, la modifica sparirebbe. ` +
      `Portala anche in routines/automazioni/${nome}, poi aggiorna qui l'impronta`);
  }
});

test('la copia in attesa cambia davvero qualcosa', () => {
  for (const nome of nomiYaml(IN_ATTESA).filter((n) => existsSync(join(ATTIVI, n)))) {
    assert.notEqual(impronta(join(IN_ATTESA, nome)), impronta(join(ATTIVI, nome)), `routines/automazioni/${nome} è uguale all'attiva: si toglie`);
  }
});
