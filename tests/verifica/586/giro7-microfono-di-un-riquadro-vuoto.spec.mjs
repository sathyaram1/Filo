// Verifica #586, giro 7 — la stessa porta di «tolto il permesso, il microfono
// resta aperto», ma senza niente di ostile: il widget dentro un riquadro vuoto.
//
// Un riquadro scritto dalla pagina (`about:blank`) è la forma con cui vivono il
// lettore, il modulo di pagamento, la finestra della videochiamata. Il giro 6
// ha fatto in modo che un riquadro così possa CHIEDERE il microfono. Qui si
// guarda l'altra metà: quando l'utente toglie quel permesso, il microfono che
// il riquadro ha in mano si deve chiudere.

import { test, expect } from '../../fixtures/electron.mjs';

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function apriSicurezza(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const p = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(p, 'pagina Sicurezza non trovata').toBeTruthy();
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForTimeout(1200);
  return p;
}

const PAGINA = `<!doctype html><html><body style="margin:0;padding:12px">
<p>pagina con un widget dentro un riquadro vuoto</p>
<iframe id="vuoto" style="width:280px;height:100px"></iframe>
<script>
  window.__t = null;
  window.__vivo = 1;
  window.__apri = async () => {
    try {
      const w = document.getElementById('vuoto').contentWindow;
      const s = await w.navigator.mediaDevices.getUserMedia({ audio: true });
      window.__t = s.getTracks()[0];
      return 'ok';
    } catch (e) { return 'no:' + ((e && e.name) || '?'); }
  };
  window.__stato = () => ({
    traccia: window.__t ? window.__t.readyState : 'niente',
    ricaricata: window.__vivo !== 1,
  });
</script></body></html>`;

test('tolto il permesso, si chiude anche il microfono preso dentro un riquadro vuoto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).host;
  await page.waitForTimeout(800);

  const esito = page.evaluate(() => window.__apri());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  const r = await esito;
  console.log('[586 g7] il riquadro vuoto ha ottenuto:', r);
  test.skip(r !== 'ok', `il riquadro non ha ottenuto il microfono (${r}): la prova non direbbe niente`);

  console.log('[586 g7] prima della revoca:', JSON.stringify(await page.evaluate(() => window.__stato())));

  const sicurezza = await apriSicurezza(app, shell);
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(1500);
  await page.waitForTimeout(4000);

  const dopo = await page.evaluate(() => window.__stato()).catch(() => ({ ricaricata: true }));
  console.log('[586 g7] dopo la revoca:', JSON.stringify(dopo));

  expect(
    !!dopo.ricaricata || dopo.traccia !== 'live',
    'tolto il permesso dalle Impostazioni, il microfono che il widget aveva aperto dentro un '
    + 'riquadro vuoto continua ad ascoltare. In Impostazioni la voce è sparita, quindi non resta '
    + 'niente da togliere, e nella cornice non c\'è più nessun cartello: chi ha appena tolto il '
    + 'permesso crede di aver chiuso il microfono e invece è ancora aperto',
  ).toBe(true);
});
