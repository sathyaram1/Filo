// Verifica #551 — giro 2. Due porte piccole che portano allo stesso stato:
// un nome che arriva a Filo diverso da com'è sul disco, o un utente lasciato
// senza il modo di scegliere.
//
// 1) L'output del terminale viene tagliato quando è enorme, e il taglio cade
//    dove capita: se cade in mezzo a un'emoji del nome (che sta su due unità
//    di testo) l'ultima riga esce con mezzo carattere. È il taglio, non la
//    shell — succede su Windows come su Linux.
// 2) Quando il nome storpiato è quello di una CARTELLA e nella cartella
//    superiore ce n'è più d'una che gli somiglia, Filo dice solo «a quel
//    percorso non c'è nessun file». Se a essere ambiguo è il nome del FILE,
//    invece, le elenca e l'utente sceglie. È la stessa domanda, con due
//    risposte diverse a seconda del pezzo di percorso storpiato.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const eseguiComando = (page, comando) =>
  page.evaluate((c) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'filo_confirm_action',
      action: { type: 'ESEGUI_COMANDO', comando: c },
    }, (r) => resolve(r));
  }), comando);

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

test('il taglio dell’output non lascia mezzo carattere in fondo', async ({ openTab }) => {
  const page = await openTab(HOME);
  await accendiTerminale(page);

  // Riempitivo fino al punto esatto del taglio, poi un'emoji: il taglio cade
  // fra le sue due metà.
  const r = await eseguiComando(page, `printf '%0.sa' $(seq 1 11999); printf '\\360\\237\\223\\204 finale\\n'`);
  expect(r.executed, `il comando non è partito: ${JSON.stringify(r).slice(0, 300)}`).toBe(true);
  const stdout = String(r.output?.stdout || '');

  const mezzoCarattere = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  expect(
    mezzoCarattere.test(stdout),
    `l’output tagliato finisce con mezzo carattere: ${JSON.stringify(stdout.slice(-6))}`,
  ).toBe(false);
});

test('se a essere ambiguo è il nome della CARTELLA, Filo dice quali sono', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-amb-');
  try {
    mkdirSync(join(base, 'Città vecchia'), { recursive: true });
    mkdirSync(join(base, 'Citta vecchia'), { recursive: true });
    writeFileSync(join(base, 'Città vecchia', 'nota.txt'), 'appunti\n', 'utf8');
    const page = await openTab(HOME);

    const r = await leggiDocumento(page, join(base, 'Citt� vecchia', 'nota.txt'));
    const detail = String(r?.output?.detail || '');
    expect(r?.output?.ok, 'con due cartelle simili Filo non deve indovinare').toBe(false);
    // Quello che serve all'utente per uscirne: i nomi fra cui scegliere. Sul
    // nome del file Filo li dà già; sul nome della cartella no.
    expect(
      detail,
      `all’utente non viene detto fra quali cartelle scegliere: ${JSON.stringify(detail)}`,
    ).toContain('Citt');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
