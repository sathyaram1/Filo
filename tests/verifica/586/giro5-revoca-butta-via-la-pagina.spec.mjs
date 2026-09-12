// Verifica #586, giro 5 — togliere un permesso butta via quello che stavi
// scrivendo.
//
// #586 chiede che le scelte ricordate siano «modificabili dalle impostazioni e
// revocabili dal menu del tasto destro sulla scheda». Il giro 4 ha chiesto, in
// più, che la revoca chiudesse anche quello che il sito ha già in mano — un
// microfono aperto restava aperto. La correzione lo fa ricaricando la scheda.
//
// Il prezzo non è dichiarato da nessuna parte. Chi va in Impostazioni per
// togliere la fotocamera a un sito si ritrova la sua pagina ricaricata: il
// commento che stava scrivendo, il modulo mezzo compilato, il posto in cui era
// arrivato leggendo, tutto perso. Non c'è un avviso prima, non c'è un modo di
// tornare indietro, e la riga su cui si clicca non dice che succederà.
//
// Per chi usa Filo: hai dato il microfono a un sito. Più tardi, mentre scrivi
// un messaggio lungo in quella stessa pagina, vai in Impostazioni e glielo
// togli. Torni sulla pagina e il campo è vuoto.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<input id="campo" style="font-size:18px;width:340px">
<script>
  window.__mic = () => navigator.mediaDevices.getUserMedia({ audio: true })
    .then((s) => { window.__t = s.getTracks()[0]; return 'ok'; }, (e) => 'no:' + e.name);
  window.__vivo = () => (window.__t ? window.__t.readyState : 'niente');
</script></body></html>`;

const SCRITTO = 'una risposta lunga che sto scrivendo da dieci minuti';

test('togliere il permesso dalle Impostazioni non deve buttare via quello che stavi scrivendo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  const m = page.evaluate(() => window.__mic());
  await shell.waitForTimeout(2000);
  const consenti = shell.locator('.perm-chip .perm-chip-allow');
  expect(await consenti.count(), 'la domanda del microfono deve comparire').toBe(1);
  await consenti.first().click();
  console.log('[586 g5] microfono:', await Promise.race([m, new Promise((r) => setTimeout(() => r('(attesa)'), 8000))]));

  // Chi usa Filo intanto sta scrivendo in quella pagina.
  await page.fill('#campo', SCRITTO);
  expect(await page.inputValue('#campo')).toBe(SCRITTO);

  // Va in Impostazioni → Sicurezza e toglie la scelta.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1500);
  const righe = await sicurezza.locator('#perms-list li').allTextContents();
  console.log('[586 g5] elenco prima della revoca:', JSON.stringify(righe));
  expect(righe.join(' '), 'la scelta sul microfono deve essere elencata').toContain('Microfono');
  await sicurezza.locator('#perms-list li button').last().click();
  await sicurezza.waitForTimeout(2500);

  const dopo = await page.inputValue('#campo').catch(() => '(scheda irraggiungibile)');
  console.log('[586 g5] il campo dopo la revoca:', JSON.stringify(dopo));
  console.log('[586 g5] la traccia del microfono dopo la revoca:',
    await page.evaluate(() => window.__vivo()).catch(() => '?'));

  expect(
    dopo,
    'togliere un permesso ha ricaricato la pagina e ha buttato via quello che chi usa Filo '
    + 'stava scrivendo. Niente lo avvisa prima e niente lo può recuperare: chiudere un '
    + 'microfono non deve costare il testo di chi naviga',
  ).toBe(SCRITTO);
});

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  return null;
}
