// Preferenze → Modalità terminale: le shell offerte devono essere quelle che
// esistono davvero sul computer di chi guarda.
//
// PERCHÉ ESISTE
//   L'elenco era fisso: PowerShell, Prompt dei comandi (cmd), Bash (WSL) —
//   i tre nomi di Windows, mostrati anche su un Mac, dove nessuno dei tre
//   esiste. Il comando poi partiva lo stesso (il main ricade su /bin/sh), ma
//   l'utente sceglieva fra tre cose immaginarie e non capiva cosa stesse
//   davvero usando. Un menu che mente è peggio di un menu assente.
//
//   Questo spec gira su Linux (come tutta la suite qui): è il ramo "non
//   Windows", lo stesso che vede un Mac. Senza il fix è ROSSO — l'elenco
//   conterrebbe "powershell".

import { test, expect } from './fixtures/electron.mjs';

test('preferenze: fuori da Windows le shell offerte sono quelle del sistema, non quelle di Windows', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#terminalShell', { timeout: 8_000 });

  const stato = await page.evaluate(() => ({
    sistema: window.filo?.sistema || null,
    valori: [...document.getElementById('terminalShell').options].map((o) => o.value),
    etichette: [...document.getElementById('terminalShell').options].map((o) => o.textContent.trim()),
    scelta: document.getElementById('terminalShell').value,
  }));

  // La pagina deve sapere su che sistema gira: senza, non può decidere niente.
  expect(stato.sistema, 'la pagina non sa su che sistema gira').toBeTruthy();
  test.skip(stato.sistema === 'win32', 'su Windows le shell di Windows sono quelle giuste');

  expect(stato.valori, 'PowerShell offerto fuori da Windows').not.toContain('powershell');
  expect(stato.valori, 'cmd offerto fuori da Windows').not.toContain('cmd');
  expect(stato.valori).toContain('sh');
  expect(stato.etichette.join(' ')).not.toMatch(/WSL/i);

  // E ne deve risultare una scelta valida: un menu senza niente di selezionato
  // salverebbe una preferenza vuota.
  expect(stato.valori).toContain(stato.scelta);
});
