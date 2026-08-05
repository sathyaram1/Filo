// Blocco apertura siti in blacklist (#170.3) — e2e.
//
// Assertiamo il COMPORTAMENTO, non un messaggio:
//   1) cliccare un link verso un sito in blacklist (referrer NON di ricerca)
//      → la navigazione è bloccata (la tab NON cambia URL) e compare la
//        notifica "Sito bloccato" con l'azione "Apri comunque";
//   2) "Apri comunque" apre davvero il sito (bypassa il blocco);
//   3) un'apertura ORIGINATA DA FILO (programmatica, come l'azione NAVIGA) verso
//      lo stesso sito in blacklist è CONSENTITA.
//
// L'eccezione "referrer di motore di ricerca" (caso 2 della spec) è coperta in
// modo esaustivo dallo unit test tests/unit/siteBlock.test.mjs.
//
// Per rendere il blocco deterministico usiamo un DOMINIO REALE finto,
// "blocked.test" (estensione valida → entra davvero in blacklist, a differenza
// di un IP che l'app scarta di proposito). Il fixture Electron mappa
// "blocked.test" → 127.0.0.1 via --host-resolver-rules, così le pagine sono
// comunque servite dal testServer locale. Disattiviamo le liste pubbliche per
// non dipendere dalla rete.

import { test, expect } from './fixtures/electron.mjs';

// Host finto messo in blacklist. Deve combaciare con la regola host-resolver
// del fixture (MAP blocked.test 127.0.0.1).
const BLOCKED_HOST = 'blocked.test';

async function enableBlock(shell) {
  await shell.evaluate((host) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [host] } } },
  }), BLOCKED_HOST);
  // lascia propagare configureFromSettings nel main
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

// URL servito dal testServer locale ma con hostname "blocked.test" (che il
// fixture risolve a 127.0.0.1): stesso contenuto, host in blacklist.
function blockedUrl(testServer, body) {
  return testServer.html(body).replace('127.0.0.1', BLOCKED_HOST);
}

test('blocco diretto: click su link verso sito in blacklist → bloccato + notifica', async ({ shell, openTab, testServer }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">TARGET BLOCCATO</h1>');
  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${targetUrl}">vai</a>`,
  );

  // La pagina di partenza viene aperta da Filo (programmatica) → consentita.
  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });

  // Click sul link: è una navigazione top-level con referrer NON di ricerca.
  await page.evaluate(() => document.getElementById('go').click());

  // La notifica di blocco compare nella shell, con l'azione "Apri comunque".
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toBeVisible();

  // La tab NON ha navigato: è rimasta sulla pagina di partenza (la navigazione
  // verso il sito in blacklist è stata annullata).
  await page.waitForTimeout(500);
  expect(page.url()).toBe(fromUrl);
});

test('"Apri comunque" apre il sito bypassando il blocco', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">APERTO COMUNQUE</h1>');
  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${targetUrl}">vai</a>`,
  );

  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('go').click());

  const action = shell.locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await expect(action).toBeVisible({ timeout: 6000 });
  await action.click();

  // Il sito si apre davvero: compare un WebContentsView che mostra il target.
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const has = await w.evaluate(() => !!document.getElementById('t') && document.getElementById('t').textContent.includes('APERTO COMUNQUE'));
        if (has) return true;
      } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true);
});

test('Sicurezza: il toggle e la blacklist dedicata persistono', async ({ openTab }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock', { timeout: 8000 });

  // I controlli esistono.
  await expect(page.locator('#sec-siteblock')).toHaveCount(1);
  await expect(page.locator('#sec-siteblock-lists')).toHaveCount(1);
  await expect(page.locator('#sec-siteblock-blacklist')).toHaveCount(1);

  // Aggiunge un dominio alla blacklist dedicata e salva (change).
  await page.locator('#sec-siteblock-blacklist').fill('cattivo.example\naltro.test');
  await page.locator('#sec-siteblock-blacklist').dispatchEvent('change');

  await expect
    .poll(() => page.evaluate(async () => {
      const sb = (await window.SN_STORAGE.getSettings()).security?.siteBlock || {};
      return sb.blacklist || [];
    }), { timeout: 4000 })
    .toEqual(['cattivo.example', 'altro.test']);

  // Sopravvive a una ricarica della pagina.
  await page.reload();
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await expect(page.locator('#sec-siteblock-blacklist')).toHaveValue('cattivo.example\naltro.test');
});

test('apertura via Filo (programmatica) verso sito in blacklist → consentita', async ({ shell, openTab, testServer }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">APERTO DA FILO</h1>');

  // openTab usa window.filoShell.tabs.open → apertura programmatica, lo stesso
  // percorso dell'azione NAVIGA di Filo. Non passa da will-navigate, quindi NON
  // viene bloccata anche se l'host è in blacklist.
  const page = await openTab(targetUrl);
  await expect(page.locator('#t')).toHaveText('APERTO DA FILO', { timeout: 8000 });

  // Nessuna notifica di blocco.
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(0);
});
