// «Segnami dal dentista giovedì alle tre» (#533, ottavo giro di verifica).
//
// Prima la chat scriveva «Evento creato» e non esisteva nessun evento: nessun
// file, nessun bottone vivo, niente nel calendario. L'assert guarda il successo
// per l'utente: l'evento c'è come file, e il bottone in chat lo consegna al
// calendario del computer.

import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test('un evento diventa un file vero, e il bottone in chat lo apre col calendario', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'EVENTO_CALENDARIO', data: '2026-10-02', ora: '15:00', titolo: 'Dentista',
  }, {}));

  expect(r.executed, 'l\'evento non è stato preparato').toBe(true);
  const percorso = r.output.evento.percorso;
  const testo = readFileSync(percorso, 'utf8');
  expect(testo).toContain('BEGIN:VEVENT');
  expect(testo).toContain('DTSTART:20261002T150000');
  expect(testo).toContain('SUMMARY:Dentista');

  // Chi ha aperto per davvero: lo stub dei test annota shell.openPath invece di
  // chiamare il sistema.
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    globalThis.__origOpenPath = shell.openPath;
    shell.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
  });

  const stato = await page.evaluate(async (azione) => {
    const host = document.createElement('div');
    host.id = 'test-evento';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [azione]);
    const b = host.querySelector('button');
    if (!b) return { bottone: false };
    const prima = b.textContent;
    b.click();
    await new Promise((res) => setTimeout(res, 1200));
    return { bottone: true, prima, dopo: b.textContent };
  }, { type: 'EVENTO_CALENDARIO', titolo: 'Dentista', data: '2026-10-02', ora: '15:00', _output: r.output });

  const aperti = await app.evaluate(({ shell }) => {
    if (globalThis.__origOpenPath) shell.openPath = globalThis.__origOpenPath;
    return globalThis.__aperti || [];
  });

  expect(stato.bottone, 'in chat non c\'è nessun bottone da premere').toBe(true);
  expect(stato.prima).toContain('Aggiungi al calendario');
  expect(aperti, 'il bottone non ha consegnato l\'evento al calendario').toContain(percorso);
  expect(stato.dopo).toContain('Aperto nel calendario');
});
