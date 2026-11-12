// Giro 1 della verifica #1249: l'ambito della posta non deve mettere insieme le tre cose che il § 5.1
// vieta insieme (testo non fidato, dati privati, un'uscita verso l'esterno come la ricerca sul web). Non apre Filo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const spec = () => readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
const riga = (inizio) => spec().split('\n').find((l) => l.startsWith(`| ${inizio}`));

test('r1 l\'ambito che legge la casella di Filo non cerca anche sul web', () => {
  const r = riga('`posta`');
  expect(r, 'riga dell\'ambito `posta` nella tabella del § 5.2').toBeTruthy();
  const puo = r.split('|')[2];
  const leggeLaCasella = /casella|messaggi|mail/i.test(puo);
  const esceSulWeb = /web|internet|scaric/i.test(puo);
  expect(leggeLaCasella && esceSulWeb, `«${puo.trim()}»`).toBe(false);
});
