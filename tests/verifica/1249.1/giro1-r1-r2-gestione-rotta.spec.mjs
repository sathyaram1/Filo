// Giro 1 della verifica #1249.1: una gestione del lavoro ferma su un guasto già passato all'owner non va
// riaccesa da altri eventi, e il controllo su di lei deve accorgersi di un'istanza che cade. Non apre Filo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sezione = (titolo) => {
  const t = readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
  const i = t.indexOf(`\n${titolo}`);
  if (i < 0) throw new Error(`sezione assente: ${titolo}`);
  const resto = t.slice(i + titolo.length + 1);
  const fine = resto.search(/\n#{2,3} /);
  return (fine < 0 ? resto : resto.slice(0, fine)).replace(/\s+/g, ' ');
};
const frasi = (testo) => testo.split(/(?<=[.:;])\s/);

test('r1 mentre una sua domanda di guasto aspetta l\'owner, la gestione del lavoro non viene riaccesa da altri guasti, attese o sveglie', () => {
  const regola = frasi(sezione('### 4.3')).find((f) => /anticip/i.test(f)
    && /\bapert[ae]\b|finché l'owner|risposta dell'owner|l'owner (non )?rispond/i.test(f));
  expect(regola, 'una regola che sospende le accensioni anticipate mentre il suo guasto è aperto').toBeTruthy();
});

test('r2 il controllo su di lei si accorge di un\'istanza che cade anche se ha scritto nel taccuino', () => {
  const s = sezione('### 4.3');
  const controllo = s.slice(s.indexOf('Chi controlla lei'));
  expect(controllo.split(/\s-\s\*\*|\n/)[0]).toMatch(/(sessione|istanz)[^.]*(chius|finit|termin|rilasci|cad|esito|rapporto)/i);
});
