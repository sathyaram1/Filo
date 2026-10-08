// Sentinella: Electron è il motore che apre ogni pagina, e una major fuori supporto non riceve più le correzioni di
// sicurezza di Chromium (#1068: la 33 è rimasta ferma diciassette mesi senza che niente lo dicesse). Electron segue le
// ultime tre major stabili e ne fa uscire una ogni otto settimane. A ogni aggiornamento si alzano MAJOR e USCITA_STABILE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MAJOR = 44;
const USCITA_STABILE = '2026-08-25';
const SETTIMANE_DI_SUPPORTO = 3 * 8;
const COME = 'porta Electron all\'ultima stabile (npm view electron dist-tags.latest), poi alza MAJOR e USCITA_STABILE '
  + 'in tests/unit/electronSupportato.test.mjs con la data di releases.electronjs.org; cosa controllare nel salto: '
  + 'patterns/aggiornare-electron.md';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = (nome) => JSON.parse(readFileSync(join(ROOT, nome), 'utf8'));

function majorDi(versione) {
  const m = /^(\d+)\.\d+\.\d+(-.+)?$/.exec(String(versione || ''));
  return m ? { major: Number(m[1]), anteprima: Boolean(m[2]) } : null;
}

test('lockfile e package.json chiedono la stessa major stabile di Electron, quella che la sentinella conosce', () => {
  const nelLock = json('package-lock.json').packages?.['node_modules/electron']?.version;
  const v = majorDi(nelLock);
  assert.ok(v, `package-lock.json non risolve Electron a una versione leggibile (${nelLock})`);
  assert.equal(v.anteprima, false, `Electron ${nelLock} è un'anteprima (alpha/beta): nelle mani degli utenti va una stabile`);
  const intervallo = String(json('package.json').devDependencies?.electron || '');
  const m = /^[\^~]?(\d+)\./.exec(intervallo);
  assert.ok(m, `package.json chiede Electron come «${intervallo}»: serve una major scritta, come ^${MAJOR}.0.0`);
  assert.equal(Number(m[1]), v.major, `package.json chiede la ${m[1]} e il lockfile ha la ${v.major}`);
  assert.equal(v.major, MAJOR, `il lockfile ha Electron ${v.major} e la sentinella conosce la ${MAJOR}: ${COME}`);
});

test('la major di Electron è ancora fra le ultime tre che ricevono le correzioni di sicurezza', () => {
  const uscita = Date.parse(`${USCITA_STABILE}T00:00:00Z`);
  assert.ok(Number.isFinite(uscita), `USCITA_STABILE «${USCITA_STABILE}» non è una data`);
  const fine = new Date(uscita + SETTIMANE_DI_SUPPORTO * 7 * 24 * 3600 * 1000);
  assert.ok(Date.now() < fine.getTime(),
    `Electron ${MAJOR} è uscita il ${USCITA_STABILE} e dal ${fine.toISOString().slice(0, 10)} ne sono uscite altre tre: `
    + `non riceve più le correzioni di sicurezza. Non è un rosso del tuo ramo: ${COME}`);
});
