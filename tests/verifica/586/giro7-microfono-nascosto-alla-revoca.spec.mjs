// Verifica #586, giro 7 — il microfono che resta aperto a permesso tolto,
// dall'ultima porta rimasta.
//
// «Togliere il permesso toglie anche quello che il sito ha già in mano» è la
// garanzia chiusa nel giro 4 e riaperta due volte (giro 5, giro 6). Oggi Filo
// chiede alla pagina di fermare le proprie tracce e ricarica solo se qualcosa
// resta vivo lo stesso. Il conto delle tracce lo tiene un pezzo di Filo che
// vive nel mondo del sito, avvolgendo la funzione con cui si chiede il
// microfono, e c'è una rete di sicurezza: se in quella pagina non è mai passata
// nessuna traccia, Filo non ci crede e ricarica lo stesso.
//
// Qui si prova la combinazione che scivola in mezzo: il sito prende una prima
// traccia dalla via normale, così il conto non è zero e la rete di sicurezza
// non scatta, e una SECONDA per una via che l'avvolgimento non copre. Se la
// seconda resta viva dopo la revoca, il microfono continua ad ascoltare a
// permesso tolto e in Impostazioni non c'è più niente da togliere.

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

const PAGINA = `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__prima = null;
  window.__nascosta = null;
  window.__vive = 0;
  window.__apri = async () => {
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: true });
      window.__prima = a.getTracks()[0];
    } catch (e) { return 'rifiutato:' + ((e && e.name) || 'errore'); }
    try {
      // La stessa richiesta, presa dalla funzione originale invece che da
      // quella che il sito si trova addosso.
      const grezza = MediaDevices.prototype.getUserMedia;
      const b = await grezza.call(navigator.mediaDevices, { audio: true });
      window.__nascosta = b.getTracks()[0];
    } catch (e) { return 'seconda-no:' + ((e && e.name) || 'errore'); }
    window.__vive++;
    return 'ok';
  };
  window.__stato = () => ({
    prima: window.__prima ? window.__prima.readyState : 'niente',
    nascosta: window.__nascosta ? window.__nascosta.readyState : 'niente',
    ricaricata: window.__vive === 0,
  });
</script></body></html>`;

test('tolto il permesso, nessun microfono di quella pagina resta aperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__apri());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  const r = await esito;
  console.log('[586 g7] apertura del microfono:', r);
  test.skip(r !== 'ok', `le due tracce non si sono aperte (${r}): la prova non direbbe niente`);

  const prima = await page.evaluate(() => window.__stato());
  console.log('[586 g7] prima della revoca:', JSON.stringify(prima));

  const sicurezza = await apriSicurezza(app, shell);
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(1500);
  await page.waitForTimeout(4000);

  const dopo = await page.evaluate(() => window.__stato()).catch(() => ({ errore: true }));
  console.log('[586 g7] dopo la revoca:', JSON.stringify(dopo));

  // Se la pagina è stata ricaricata, il microfono è chiuso per forza: va bene.
  const ricaricata = !!(dopo && (dopo.ricaricata || dopo.errore));
  expect(
    ricaricata || dopo.nascosta !== 'live',
    'tolto il permesso dalle Impostazioni, il microfono che il sito aveva aperto per una seconda '
    + 'via continua ad ascoltare: la pagina non viene ricaricata perché la prima traccia, quella '
    + 'che Filo sa contare, si è fermata, e nessuno guarda l\'altra. In Impostazioni la voce non '
    + 'c\'è più, quindi non resta niente da togliere e chi naviga crede di aver chiuso il microfono',
  ).toBe(true);
});
