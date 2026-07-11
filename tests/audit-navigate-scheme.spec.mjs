// AUDIT (#248): l'handler IPC 'tabs:navigate' rinaviga una scheda esistente
// chiamando navigate() → loadURL() PROGRAMMATICO, senza validare lo schema.
//
// A differenza di openTab() (già protetto, #247), navigate() non passava da
// isWebUnsafeNav(): il gate in will-navigate scatta SOLO per navigazioni
// in-place originate dal contenuto, non per un loadURL programmatico.
//
// Conseguenza: window.filoShell.tabs.navigate(id, 'file:///etc/passwd') (o un
// UNC file://server-ostile/share) caricava davvero quello schema. Su Windows un
// percorso UNC avvia l'autenticazione NTLM e fa trapelare l'hash della password
// al server ostile; file:///C:/… espone file locali.
//
// Questo test ASSERISCE il successo della difesa: dopo un navigate() verso
// file://, l'URL della scheda NON deve essere file://. Senza il fix diventa
// rosso (la scheda carica file:///etc/passwd).

import { test, expect } from './fixtures/electron.mjs';

test('tabs:navigate NON carica schemi file:// (bypassa will-navigate)', async ({ shell }) => {
  // La shell espone window.filoShell.tabs.* → canale IPC tabs:navigate.
  // Apriamo una scheda web-safe, poi proviamo a rinavigarla verso file://.
  const openId = await shell.evaluate(async () => {
    const r = await window.filoShell.tabs.open('filo://newtab/');
    return r && r.id;
  });
  expect(openId, 'la scheda di partenza deve aprirsi').toBeTruthy();

  // Attende che la scheda sia registrata e stabile.
  await new Promise((r) => setTimeout(r, 300));

  // Tenta la navigazione ostile via IPC tab-control.
  await shell.evaluate(async (id) => {
    await window.filoShell.tabs.navigate(id, 'file:///etc/passwd');
  }, openId);

  await new Promise((r) => setTimeout(r, 500));

  // Legge lo snapshot delle schede dal main: l'URL della scheda NON deve essere
  // diventato file://. La navigazione ostile va scartata, la scheda resta dov'era.
  const snap = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
  const tab = (snap.tabs || []).find((t) => t.id);
  const anyFile = (snap.tabs || []).some((t) => String(t.url || '').startsWith('file://'));

  expect(anyFile,
    'SICUREZZA: tabs:navigate NON deve caricare uno schema file:// (leak hash NTLM)'
  ).toBe(false);

  // Difesa in profondità: nessuna webContents dovrebbe essere finita su file://.
  // (snapshot copre l'URL logico della scheda; qui basta l'assert sopra.)
  expect(tab, 'la scheda deve esistere ancora dopo il tentativo bloccato').toBeTruthy();
});
