// Verifica #583, giro 7 — il comando che assegna i numeri alle segnalazioni
// che non ce l'hanno deve ancora darli in ordine di arrivo.
//
// Il giro 6 aveva rilevato che quel comando chiedeva i primi mille feedback e
// li trattava come tutti. La correzione ha sostituito la domanda: adesso pagina
// con un cursore sul NOME del documento e poi rimette in ordine di data
// d'invio dal lato di chi legge. La paginazione è giusta; l'ordinamento no.
//
// Lo script gira intero, con la rete finta di `giro7-rete-finta-backfill.mjs`:
// tre segnalazioni senza numero, il cui ordine per nome del documento è
// l'opposto di quello per data d'invio. La promessa scritta nel comando è
// «i feedback più vecchi prendono i numeri più bassi»: #1 deve andare alla più
// vecchia.
//
// Senza il difetto è verde; col difetto #1 va alla più RECENTE, in silenzio.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, '..', '..', '..');

test('i numeri assegnati a mano seguono la data d\'invio, non il nome del documento', () => {
  const uscita = execFileSync(process.execPath, [
    '--import', new URL('./giro7-rete-finta-backfill.mjs', import.meta.url).href,
    resolve(RADICE, 'scripts', 'backfill-feedback-numbers.mjs'),
    '--dry-run',
  ], {
    cwd: RADICE,
    encoding: 'utf8',
    env: {
      ...process.env,
      FILO_ADMIN_REFRESH_TOKEN: 'refresh-finto',
      FILO_SA_KEY: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
    },
  });

  // Le righe del giro a vuoto: «  • #1 → <id>  «titolo»».
  const assegnati = new Map();
  for (const riga of uscita.split(/\r?\n/)) {
    const m = riga.match(/#(\d+)\s*→\s*(\S+)/);
    if (m) assegnati.set(Number(m[1]), m[2]);
  }

  expect(assegnati.size, `il giro a vuoto deve assegnare tre numeri.\n${uscita}`).toBe(3);
  expect(assegnati.get(1), `#1 deve andare alla segnalazione più VECCHIA.\n${uscita}`)
    .toBe('ccc-vecchio');
  expect(assegnati.get(2), `#2 alla segnalazione di mezzo.\n${uscita}`).toBe('bbb-mezzo');
  expect(assegnati.get(3), `#3 alla più recente.\n${uscita}`).toBe('aaa-recente');
});
