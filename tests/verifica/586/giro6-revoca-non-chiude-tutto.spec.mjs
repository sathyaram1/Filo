// Verifica #586, giro 6 — «togliere il permesso deve togliere anche quello che
// il sito ha già in mano».
//
// È la garanzia chiusa nel giro 4: si toglieva la scelta dalle Impostazioni,
// l'elenco si svuotava e il microfono restava aperto. La chiusura di allora
// ricaricava la scheda. Nel giro 5 quella ricarica si è rivelata cara (butta via
// quello che chi naviga stava scrivendo), e adesso Filo prima CHIEDE alla pagina
// di fermare le proprie tracce e ricarica solo se qualcosa resta vivo.
//
// Qui si guarda se la domanda arriva davvero dappertutto:
//  · la traccia presa da un RIQUADRO INCORPORATO dentro la pagina;
//  · la traccia CLONATA, che il sito si tiene da parte.
// In tutti e due i casi il microfono deve chiudersi. Se chi risponde «non è
// rimasto vivo niente» è solo il riquadro principale, la ricarica non parte e il
// sito continua ad ascoltare a permesso tolto.

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

async function togliDalleImpostazioni(sicurezza, host) {
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(1500);
}

test('il microfono preso da un riquadro incorporato si chiude quando si toglie il permesso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  const dentro = testServer.html(`<!doctype html><html><body><p>riquadro</p>
<script>
  window.__tracce = [];
  window.__microfono = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__tracce = s.getTracks(); return s.getTracks().map((t) => t.kind + ':' + t.readyState); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__stato = () => (window.__tracce || []).map((t) => t.kind + ':' + t.readyState);
  window.addEventListener('message', async (e) => {
    if (e.data === 'chiedi') parent.postMessage({ esito: await window.__microfono() }, '*');
    if (e.data === 'stato') parent.postMessage({ stato: window.__stato() }, '*');
  });
</script></body></html>`);

  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
<p>pagina che ospita un riquadro</p>
<iframe id="f" src="${dentro}" allow="microphone" style="width:300px;height:120px"></iframe>
<script>
  window.__risposte = [];
  window.addEventListener('message', (e) => window.__risposte.push(e.data));
  window.__chiedi = () => document.getElementById('f').contentWindow.postMessage('chiedi', '*');
  window.__stato = () => {
    document.getElementById('f').contentWindow.postMessage('stato', '*');
    return null;
  };
  window.__ultimo = (k) => {
    for (let i = window.__risposte.length - 1; i >= 0; i--) {
      if (window.__risposte[i] && window.__risposte[i][k] !== undefined) return window.__risposte[i][k];
    }
    return null;
  };
</script></body></html>`);
  const host = new URL(page.url()).host;

  await page.evaluate(() => window.__chiedi());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();

  const esito = await aspetta(async () => page.evaluate(() => window.__ultimo('esito')), 20_000);
  console.log('[586 g6] il riquadro incorporato ha ottenuto:', JSON.stringify(esito));
  expect(esito, 'il riquadro deve ottenere il microfono dopo il Consenti').toEqual(['audio:live']);

  const sicurezza = await apriSicurezza(app, shell);
  await togliDalleImpostazioni(sicurezza, host);
  await page.waitForTimeout(3000);

  await page.evaluate(() => window.__stato());
  await page.waitForTimeout(800);
  const stato = await page.evaluate(() => window.__ultimo('stato'));
  console.log('[586 g6] il microfono del riquadro dopo la revoca:', JSON.stringify(stato));

  expect(
    (stato || []).filter((s) => String(s).endsWith(':live')),
    'tolto il permesso dalle Impostazioni, il microfono preso dal riquadro incorporato continua '
    + 'ad ascoltare: la domanda «ferma quello che hai» arriva solo al riquadro principale, che '
    + 'non ha niente da fermare e risponde che è tutto a posto, così la ricarica non parte mai',
  ).toEqual([]);
});

test('anche l\'«Interrompi» del cartello deve chiudere la copia che il sito si è messa da parte', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__copia = null;
  window.__microfono = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__copia = s.getTracks()[0].clone(); return s.getTracks().map((t) => t.kind + ':' + t.readyState); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__statoCopia = () => (window.__copia ? window.__copia.kind + ':' + window.__copia.readyState : 'niente');
</script></body></html>`);

  const esito = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito).toEqual(['audio:live']);

  const cartello = shell.locator('.perm-live');
  await expect(cartello).toHaveCount(1, { timeout: 15_000 });
  console.log('[586 g6] cartello:', JSON.stringify(await cartello.innerText()));
  await cartello.locator('button').filter({ hasText: /interrompi/i }).first().click();
  await page.waitForTimeout(3000);

  const copia = await page.evaluate(() => window.__statoCopia());
  console.log('[586 g6] la copia dopo l\'Interrompi:', JSON.stringify(copia));
  expect(
    copia,
    'premuto «Interrompi» sul cartello, la copia della traccia che il sito si era messa da parte '
    + 'continua ad ascoltare: è la stessa causa della revoca dalle Impostazioni',
  ).not.toBe('audio:live');
});

test('il microfono clonato dal sito si chiude quando si toglie il permesso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__copia = null;
  window.__microfono = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => {
      // Il sito si tiene una copia della traccia: quella che Filo conosce è
      // l'originale, e fermare l'originale non ferma la copia.
      window.__copia = s.getTracks()[0].clone();
      return s.getTracks().map((t) => t.kind + ':' + t.readyState);
    },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__statoCopia = () => (window.__copia ? window.__copia.kind + ':' + window.__copia.readyState : 'niente');
</script></body></html>`);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito).toEqual(['audio:live']);
  expect(await page.evaluate(() => window.__statoCopia())).toBe('audio:live');

  const sicurezza = await apriSicurezza(app, shell);
  await togliDalleImpostazioni(sicurezza, host);
  await page.waitForTimeout(3000);

  const copia = await page.evaluate(() => window.__statoCopia());
  console.log('[586 g6] la copia della traccia dopo la revoca:', JSON.stringify(copia));

  expect(
    copia,
    'tolto il permesso, la copia che il sito si era messa da parte continua ad ascoltare: Filo '
    + 'ferma solo le tracce che ha consegnato lui, e visto che quelle si fermano conclude che '
    + 'non è rimasto niente di vivo e non ricarica',
  ).not.toBe('audio:live');
});
