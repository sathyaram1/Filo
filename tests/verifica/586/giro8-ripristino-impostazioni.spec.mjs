// Verifica #586, giro 8 — la quarta porta della stessa garanzia: «se te lo
// tolgo non ce l'hai più».
//
// I giri 4, 6 e 7 hanno chiuso, una dopo l'altra, tre strade da cui un sito
// continuava ad ascoltare a permesso tolto. Restano le porte che non passano
// dalla revoca di un singolo permesso ma cancellano le scelte tutte insieme.
//
// Per chi usa Filo: dai il microfono a un sito. Più tardi vai in Impostazioni e
// premi «Ripristina tutte le impostazioni» — la cosa che si fa quando si vuole
// tornare puliti. L'elenco dei permessi si svuota, e in Impostazioni non c'è più
// niente da togliere. Il microfono, però, non si chiude: il sito continua ad
// ascoltare e nell'elenco non compare più nemmeno la riga da cui toglierglielo.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px"><p>pagina</p>
<script>
  window.__tracce = [];
  window.__microfono = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__tracce.push(...s.getTracks()); return s.getTracks().map((t) => t.kind + ':' + t.readyState); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__stato = () => window.__tracce.map((t) => t.kind + ':' + t.readyState);
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

test('«ripristina tutte le impostazioni» toglie la scelta: deve chiudere anche il microfono aperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  const esito = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito, 'chi consente deve ottenere il microfono').toEqual(['audio:live']);
  await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 10_000 });

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1000);
  console.log('[586 g8] elenco prima del ripristino:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));

  const risposta = await sicurezza.evaluate(() => window.chrome.runtime
    .sendMessage({ type: 'reset_settings' }).then((r) => !!(r && r.ok), (e) => 'errore:' + e));
  console.log('[586 g8] ripristino completo delle impostazioni:', risposta);

  await sicurezza.waitForTimeout(2500);
  console.log('[586 g8] elenco dopo il ripristino:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));

  await page.waitForTimeout(1500);
  const stato = await page.evaluate(() => window.__stato());
  const cartelli = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g8] il microfono dopo il ripristino:', JSON.stringify(stato),
    'cartelli:', JSON.stringify(cartelli));

  expect(
    stato.filter((s) => s.endsWith(':live')),
    'il ripristino ha cancellato la scelta e il sito continua ad ascoltare: in Impostazioni non '
    + 'resta nemmeno la riga da cui toglierglielo, quindi non c\'è più nessun punto in cui rimediare',
  ).toEqual([]);
});
