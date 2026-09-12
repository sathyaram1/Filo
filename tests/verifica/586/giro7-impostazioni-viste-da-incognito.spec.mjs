// Verifica #586, giro 7 — la stessa pagina Impostazioni, due elenchi diversi.
//
// Nel giro 2 il rilievo era che le scelte fatte in incognito non comparivano in
// Impostazioni: «chi va a cercarle lì trova un elenco che sembra completo e non
// lo è». Adesso compaiono. Qui si guarda il rovescio: le Impostazioni aperte da
// una finestra in incognito mostrano ancora le scelte delle finestre normali?
// La pagina è la stessa, e tutto il resto che c'è dentro (cookie, protezione
// dell'impronta, siti fidati) è quello vero.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

test('le Impostazioni aperte in incognito mostrano anche le scelte delle finestre normali', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  // 1) Finestra normale: un sito ottiene la fotocamera, con la domanda.
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;
  const esito = page.evaluate(() => window.__cam());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito).toBe('ok');

  // 2) Le Impostazioni della finestra normale: la scelta c'è.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1500);
  const normali = await sicurezza.locator('#perms-list li').allTextContents();
  console.log('[586 g7] Impostazioni, finestra normale:', JSON.stringify(normali));
  expect(normali.join(' ')).toContain(host);

  // 3) Le stesse Impostazioni, aperte da una finestra in incognito.
  await shell.evaluate(() => window.filoShell.openIncognito());
  const shellIncognito = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('shell.html?incognito=1'); } catch (_) { return false; }
  }) || null);
  expect(shellIncognito, 'shell della finestra in incognito non trovata').toBeTruthy();
  await shellIncognito.waitForLoadState('domcontentloaded').catch(() => {});
  await shellIncognito.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezzaInc = await aspetta(async () => app.windows().filter((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }).find((w) => w !== sicurezza) || null);
  expect(sicurezzaInc, 'pagina Sicurezza della finestra in incognito non trovata').toBeTruthy();
  await sicurezzaInc.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezzaInc.waitForTimeout(1800);
  const inIncognito = await sicurezzaInc.locator('#perms-list li').allTextContents();
  console.log('[586 g7] Impostazioni, finestra in incognito:', JSON.stringify(inIncognito));
  await sicurezzaInc.screenshot({ path: 'tests/.shots/586-giro7-impostazioni-in-incognito.png' });

  expect(
    inIncognito.join(' '),
    'le Impostazioni aperte da una finestra in incognito non elencano le scelte prese nelle '
    + 'finestre normali: la stessa pagina, con dentro gli stessi cookie e gli stessi siti fidati '
    + 'di sempre, per i permessi mostra un elenco diverso senza dire che è diverso, e da lì una '
    + 'scelta normale non si può togliere',
  ).toContain(host);
});
