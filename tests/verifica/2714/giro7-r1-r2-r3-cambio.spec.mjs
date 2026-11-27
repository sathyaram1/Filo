// Verifica #2714 giro 7: PIN detto col cambio verso il modello principale, password e PIN dopo la domanda in uscita,
// un nome di servizio dopo «in» preso per la password. Logica pura, senza aprire Filo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const G = globalThis.SN_GUARDIANO_STATICO;
const P = globalThis.SN_PAVIMENTO;
const valori = (t) => G.segretiInUscita(t).map((x) => String(x.valore));

test('r1 il PIN detto con un altro verbo di cambio, due oggetti o dopo la domanda non arriva al modello', () => {
  const passati = [];
  for (const [t, pin] of [
    ['ho cambiato il pin da 1234 a 4821', '4821'],
    ['il pin è passato da 1234 a 4821', '4821'],
    ['ho cambiato il pin con 4821', '4821'],
    ['ho settato il pin a 4821', '4821'],
    ["il pin l'ho messo a 4821", '4821'],
    ['il pin è stato messo a 4821', '4821'],
    ['il pin diventò 4821', '4821'],
    ['il pin è diventato il 4821', '4821'],
    ['ho cambiato la password in Mela!Verde77 e il pin in 4821', '4821'],
    ['Ti ricordi il pin? Era 4821', '4821'],
    ['Hai cambiato il pin? Sì, ora è 4821', '4821'],
    ['Ti ricordi il codice del cancello? Era 4821', '4821'],
    ['il pin non è più 1234, ora è 4821', '4821'],
    ['la password non è più Vecchia1!, ora è Mela!Verde77', 'Mela!Verde77'],
  ]) if (P.oscura(t).includes(pin)) passati.push(t);
  expect(passati).toEqual([]);
});

test('r2 la password o il PIN detti dopo la domanda sono un segreto in uscita, come dopo «è»', () => {
  const mancati = [];
  for (const [t, v] of [
    ['Ti ricordi la password? Era Mela!Verde77', 'Mela!Verde77'],
    ['Ti ricordi la password? È diventata Mela!Verde77', 'Mela!Verde77'],
    ['Ti ricordi la password? Ora è Mela!Verde77', 'Mela!Verde77'],
    ['Do you remember the password? It was Mela!Verde77', 'Mela!Verde77'],
    ['Ti ricordi il pin? Era 4821', '4821'],
    ['la password diventa: Mela!Verde77', 'Mela!Verde77'],
    ['la password è diventata: Mela!Verde77', 'Mela!Verde77'],
  ]) if (!valori(t).includes(v)) mancati.push(t);
  expect(mancati).toEqual([]);
  expect(valori('Hai cambiato la password? Era ora!')).toEqual([]);
});

test('r3 un nome di servizio detto dopo «in» non è la password in uscita', () => {
  for (const t of ['ho cambiato la password in PayPal', 'ho cambiato la password in iCloud', 'ho cambiato la password in WhatsApp']) {
    expect(valori(t), t).toEqual([]);
  }
});
