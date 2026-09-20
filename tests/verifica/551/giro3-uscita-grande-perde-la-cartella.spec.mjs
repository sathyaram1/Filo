// Verifica #551 — giro 3. Il passo che viene PRIMA della lamentela: Filo cerca
// il file, e per cercarlo elenca o fruga in una cartella grande.
//
// L'output di quel comando viene raccolto fino a un tetto, e oltre il tetto non
// si raccoglie più niente. Ma in fondo all'output c'è il marcatore con cui la
// shell riporta a Filo la cartella in cui è finita e com'è andato il comando:
// oltre il tetto quel marcatore non arriva. Due danni, tutti e due dalla stessa
// causa e tutti e due sul cammino della segnalazione:
//   1) il «cd» non vale più per il comando dopo — che quindi guarda nella
//      cartella sbagliata, e il file «non esiste»;
//   2) un comando FALLITO viene riportato come riuscito: la ricerca che non ha
//      trovato niente sembra andata a buon fine.
// Niente a che vedere con Windows: succede dove gira Filo.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

test('dopo un elenco lungo la cartella resta quella in cui Filo è entrato', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-grande-');
  try {
    mkdirSync(join(base, 'Documenti'), { recursive: true });
    writeFileSync(join(base, 'Documenti', 'bolletta.txt'), 'totale 84,50\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    // Entra nella cartella e fruga: l'elenco è più lungo di quanto Filo tenga.
    const grande = await eseguiComando(
      page,
      `cd '${join(base, 'Documenti')}'; printf '%0.sriga-di-elenco\\n' $(seq 1 3000)`,
    );
    expect(String(grande.output?.stdout || '').length, 'l’elenco doveva essere lungo').toBeGreaterThan(1000);

    // Il comando dopo deve partire da lì: è quello che Filo promette a sé stesso
    // quando dice che la cartella di lavoro è persistente.
    const dopo = await eseguiComando(page, 'pwd');
    expect(
      String(dopo.output?.stdout || '').trim(),
      'dopo un output lungo Filo torna a cercare nella cartella di prima',
    ).toBe(join(base, 'Documenti'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('una ricerca lunga che fallisce non viene riportata come riuscita', async ({ openTab }) => {
  const page = await openTab(HOME);
  await accendiTerminale(page);

  const r = await eseguiComando(
    page,
    `printf '%0.sriga-di-elenco\\n' $(seq 1 3000); ls /non/esiste/da/nessuna/parte`,
  );
  expect(
    r.executed,
    'un comando fallito dopo un output lungo risulta riuscito, e Filo prosegue come se avesse trovato',
  ).toBe(false);
});
