// Verifica #551 — giro 3. Il passo che viene PRIMA della lamentela: Filo cerca
// il file, e per cercarlo elenca o fruga in una cartella grande.
//
// L'output di quel comando viene raccolto fino a un tetto, e oltre il tetto non
// si raccoglie più niente. Ma in fondo all'output c'è il marcatore con cui la
// shell riporta a Filo la cartella in cui è finita e com'è andato il comando:
// oltre il tetto quel marcatore non arriva mai. Due danni dalla stessa causa,
// tutti e due dentro un solo comando (niente a che vedere con la memoria fra
// un messaggio e l'altro):
//   1) la cartella riportata non è quella in cui il comando è finito;
//   2) un comando FALLITO risulta riuscito — la ricerca che non ha trovato
//      niente sembra andata a buon fine, e Filo prosegue come se avesse trovato.
// Succede dove gira Filo: non è un guasto di Windows.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, rmSync } from 'node:fs';
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

test('dopo un elenco lungo Filo sa ancora in che cartella è finito', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-grande-');
  try {
    mkdirSync(join(base, 'Documenti'), { recursive: true });
    const page = await openTab(HOME);
    await accendiTerminale(page);

    // Un solo comando: entra nella cartella e fruga. L'elenco è più lungo di
    // quanto Filo tenga da parte.
    const r = await eseguiComando(
      page,
      `cd '${join(base, 'Documenti')}'; printf '%0.sriga-di-elenco\\n' $(seq 1 3000)`,
    );
    expect(String(r.output?.stdout || '').length, 'l’elenco doveva essere lungo').toBeGreaterThan(1000);
    expect(
      String(r.output?.cwd || ''),
      'dopo un output lungo Filo crede di essere rimasto dov’era',
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
