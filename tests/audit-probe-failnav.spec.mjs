// PROBE prober: navigazione verso dominio inesistente / connessione rifiutata —
// cosa vede l'utente? (Chrome mostra una pagina d'errore; Electron di default no.)

import { test, expect } from './fixtures/electron.mjs';

test('PROBE: dominio inesistente digitato in barra — cosa mostra la tab?', async ({ app, shell }) => {
  // Simula l'utente che digita un dominio con un refuso: normalizeUrl lo tratta
  // come URL (ha un punto) e naviga https://...
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://dominio-inesistente-refuso-xyz.com/');
  await new Promise((r) => setTimeout(r, 9000));

  // Trova la window della tab (se esiste ancora un frame caricabile).
  const wins = app.windows().map((w) => { try { return w.url(); } catch (_) { return '?'; } });
  console.log('[probe] windows:', JSON.stringify(wins));

  const snap = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => ({ url: t.url, title: t.title, active: t.id === s.activeId }));
  });
  console.log('[probe] tabs snapshot:', JSON.stringify(snap, null, 2));

  // Contenuto visibile del frame fallito, se raggiungibile.
  const failed = app.windows().find((w) => { try { return /dominio-inesistente/.test(w.url()) || /chrome-error/.test(w.url()); } catch (_) { return false; } });
  if (failed) {
    const body = await failed.evaluate(() => (document.body ? document.body.innerText.slice(0, 400) : '(no body)')).catch((e) => 'EVAL FAIL: ' + e.message);
    console.log('[probe] body del frame fallito:', JSON.stringify(body));
  } else {
    console.log('[probe] nessuna window raggiungibile per il frame fallito');
  }

  // Porta a 127.0.0.1 chiusa: connessione rifiutata.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'http://127.0.0.1:59999/');
  await new Promise((r) => setTimeout(r, 5000));
  const snap2 = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => ({ url: t.url, title: t.title, active: t.id === s.activeId }));
  });
  console.log('[probe] tabs dopo conn rifiutata:', JSON.stringify(snap2, null, 2));
  expect(true).toBe(true);
});
