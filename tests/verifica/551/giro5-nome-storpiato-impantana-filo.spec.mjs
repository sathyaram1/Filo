// Verifica #551 — giro 5. Il perdono sui nomi quasi giusti può fermare Filo
// intero, per minuti, su un nome di sessanta caratteri.
//
// Per capire se due nomi sono lo stesso nome, Filo costruisce un'espressione in
// cui ogni carattere perso diventa un jolly, e la prova contro OGNI file della
// cartella. Il tempo di quella prova raddoppia a ogni carattere perso in più:
// misurato qui, ventidue caratteri persi costano un decimo di secondo, ventotto
// ne costano otto, trenta ne costano trentaquattro — per UN file solo, e la
// cartella li moltiplica.
//
// Quel conto gira nel processo principale di Filo, che è uno: mentre gira, la
// finestra non risponde, le schede non si aprono, nessuna scorciatoia funziona.
// E il nome su cui gira non lo sceglie l'utente: lo ricopia il modello da quello
// che il terminale gli ha stampato, o da un documento che sta leggendo — cioè
// da fuori.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

test('un nome con molti caratteri persi non deve impantanare Filo', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-impantana-');
  try {
    // Un file dal nome fatto di una lettera ripetuta: basta che la parte
    // riconoscibile del nome chiesto si ritrovi in tanti punti di questo.
    writeFileSync(join(base, `${'a'.repeat(84)}b.txt`), 'niente di interessante\n');
    writeFileSync(join(base, 'bolletta.txt'), 'totale 84,50\n');

    const page = await openTab(HOME);
    // Sessanta caratteri, ventotto dei quali persi: la forma che prende un nome
    // scritto in un alfabeto che la tabella della console non contiene.
    const chiesto = join(base, `${'a�'.repeat(28)}.txt`);

    const t0 = Date.now();
    const r = await leggiDocumento(page, chiesto);
    const quanto = Date.now() - t0;

    expect(r?.output, 'nessuna risposta').toBeTruthy();
    expect(
      quanto,
      `Filo ha impiegato ${quanto} ms per dire che quel file non c'è, e per tutto quel tempo non risponde a nient'altro`,
    ).toBeLessThan(3000);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('mentre cerca un nome storpiato, Filo continua a rispondere', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-impantana-2-');
  try {
    writeFileSync(join(base, `${'a'.repeat(84)}b.txt`), 'niente\n');

    const page = await openTab(HOME);
    const chiesto = join(base, `${'a�'.repeat(28)}.txt`);

    const lento = leggiDocumento(page, chiesto);
    // Una domanda qualunque, mandata subito dopo: deve tornare senza aspettare
    // la fine della ricerca, perché non ha niente a che vedere con essa.
    const t0 = Date.now();
    const svelto = await leggiDocumento(page, join(base, 'niente-del-genere.txt'));
    const quanto = Date.now() - t0;
    await lento;

    expect(svelto?.output, 'nessuna risposta alla seconda domanda').toBeTruthy();
    expect(
      quanto,
      `una seconda richiesta, che non c'entra niente, ha aspettato ${quanto} ms: il processo principale era fermo`,
    ).toBeLessThan(3000);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
