// Verifica #586, giro 4 — quello che si può solo negare, mai consentire.
//
// #586 chiede che ogni richiesta non innocua «passi da una scelta dell'utente».
// Per l'elenco dei caratteri installati (Local Font Access: lo usano gli editor
// grafici sul web — Figma, Photopea, Canva — per farti scegliere un font del tuo
// computer) Chromium non fa mai la RICHIESTA: chiede solo «cosa è già stato
// deciso». Filo risponde «niente» e il sito si becca un elenco vuoto, senza che
// compaia nessuna domanda.
//
// Il risultato è un no definitivo: la pastiglia non arriva mai, quindi nessuna
// scelta viene mai registrata, quindi in Impostazioni quel sito non compare e
// non c'è niente da ribaltare. Si può negare, non si può consentire.
//
// Per chi usa Filo: apri un editor grafico sul web e prova a scegliere un
// carattere del tuo computer. L'elenco è vuoto, non compare nessun avviso e non
// c'è nessun posto in cui rimediare.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<button id="b" style="font-size:20px">scegli un carattere</button>
<script>
  window.__esito = null;
  document.getElementById('b').addEventListener('click', async () => {
    try { const f = await window.queryLocalFonts(); window.__esito = { n: f.length }; }
    catch (e) { window.__esito = { errore: e.name }; }
  });
</script></body></html>`;

test('i caratteri del computer: o il sito li ottiene, o almeno la domanda arriva', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  await page.click('#b');
  await shell.waitForTimeout(2500);
  const domande = await shell.locator('.perm-chip').allTextContents();
  const esito = await page.evaluate(() => window.__esito);
  console.log('[586 g4] caratteri col gestore di Filo:', JSON.stringify(esito), 'domande:', JSON.stringify(domande));

  expect(
    domande.length,
    'nessuna domanda: senza domanda nessuna scelta viene registrata, quindi in Impostazioni '
    + 'quel sito non compare e non c\'è niente da ribaltare. Si può solo negare, mai consentire',
  ).toBe(1);

  // Consentito: il sito, riprovando, deve ottenere i caratteri. Senza questo la
  // domanda sarebbe una finta.
  await shell.locator('.perm-chip .perm-chip-allow').click();
  await shell.waitForTimeout(800);
  await page.click('#b');
  await page.waitForTimeout(2000);
  const dopoIlSi = await page.evaluate(() => window.__esito);
  console.log('[586 g4] caratteri dopo il Consenti:', JSON.stringify(dopoIlSi));
  expect(
    (dopoIlSi && dopoIlSi.n) || 0,
    'dopo il Consenti il sito deve ricevere i caratteri: una domanda che non cambia niente '
    + 'è peggio di nessuna domanda',
  ).toBeGreaterThan(0);

  // E la scelta deve comparire in Impostazioni, come ogni altra.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  const righe = await sicurezza.locator('#perms-list li').allTextContents();
  console.log('[586 g4] elenco in Impostazioni:', JSON.stringify(righe));
  expect(
    righe.join(' '),
    'la scelta sui caratteri deve comparire in Impostazioni, o non si può più ribaltare',
  ).toContain('Caratteri installati');
});

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}
