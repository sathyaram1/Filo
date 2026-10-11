// Sentinella: una pagina di impostazioni aperta non è una fotografia (#667).
// Ogni pagina che salva più impostazioni insieme ascolta i cambiamenti da fuori e li rimette nei controlli;
// che ogni controllo abbia la sua voce lo tiene vociImpostazioni.test.mjs. Racconto nel file di pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PAGINE = [
  { nome: 'Preferenze', file: 'src/pages/preferences/preferences.js', riallinea: /SETTINGS_UPDATED[\s\S]{0,80}riallinea\(msg\.settings\)/ },
  { nome: 'Opzioni', file: 'src/pages/options/options.js', riallinea: /SETTINGS_UPDATED[\s\S]{0,200}riallineaPagina\('options'/ },
  { nome: 'Sicurezza e privacy', file: 'src/pages/security/security.js', riallinea: /riallineaPagina\('security'/ },
];

for (const p of PAGINE) {
  test(`${p.nome}: la pagina ascolta davvero i cambiamenti arrivati da fuori`, () => {
    const s = leggi(p.file);
    assert.match(s, /onMessage\.addListener[\s\S]{0,300}SETTINGS_UPDATED/, `${p.nome} deve ascoltare le impostazioni cambiate`);
    assert.match(s, p.riallinea, `${p.nome} deve rimettere nei controlli i valori arrivati`);
  });
}

test('Opzioni: si salta solo il controllo che l\'utente ha sotto le dita adesso, non quello col fuoco', () => {
  const s = leggi('src/pages/options/options.js');
  const ascolto = s.slice(s.indexOf("riallineaPagina('options'"), s.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.match(ascolto, /salta:[^\n]*staUsandoAdesso\(/, 'il salto deve usare la regola condivisa');
  const senzaRegola = ascolto.split('\n').filter((r) => !r.includes('staUsandoAdesso(')).join('\n');
  assert.doesNotMatch(
    senzaRegola,
    /activeElement/,
    'il fuoco resta sull\'ultimo controllo usato: saltarlo per questo lo lascia mostrare il valore vecchio (#667)',
  );
});

test('Opzioni: il modello di un\'azione scelto altrove ridisegna la griglia da cui riparte il salvataggio', () => {
  const s = leggi('src/pages/options/options.js');
  const ascolto = s.slice(s.indexOf("riallineaPagina('options'"), s.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.match(ascolto, /modelChains\s*=\s*ModelChain\.renderGrid/, 'senza, il salvataggio dopo rimanda indietro il modello scelto altrove');
});

test('la regola condivisa salta il campo in cui si scrive e il controllo premuto, non il fuoco da solo', () => {
  const s = leggi('src/shared/pageBootstrap.js');
  assert.match(s, /function staUsandoAdesso\(el\)/);
  assert.match(s, /matches\(':active'\)/, 'un controllo tenuto premuto è in uso');
  assert.match(s, /SN_PAGE_BOOTSTRAP = \{[^}]*staUsandoAdesso/);
});
