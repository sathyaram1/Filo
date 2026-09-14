// Verifica #586, giro 9 — la finestra di accesso («Continua con Google»).
//
// Filo apre come VERA finestra, e non come scheda, i popup che somigliano a un
// accesso: è la sola strada che tiene in piedi il legame fra la pagina e la
// finestra che l'OAuth usa per restituire l'esito. Quella finestra non è una
// scheda, e la domanda dei permessi va alla scheda.
//
// Per chi usa Filo: dentro una finestra di accesso un sito chiede la fotocamera
// (la verifica dell'identità con un documento, il codice QR da inquadrare) o il
// permesso di mandare notifiche. Se lì la domanda non compare, quella richiesta
// si può solo negare e mai consentire, e chi ci finisce resta bloccato in una
// finestra che non gli dice niente.
//
// Quello che deve succedere: la domanda compare da qualche parte, e rispondendo
// «Consenti» il sito ottiene. Oppure, come minimo, il rifiuto arriva subito e
// con una spiegazione — non dopo due minuti di attesa muta.

import { test, expect } from '../../fixtures/electron.mjs';

const ACCESSO = `<!doctype html><html><body style="margin:0;padding:16px">
<h1 id="titolo">Accedi</h1>
<script>window.__pronta = 1;</script></body></html>`;

async function aspetta(fn, ms = 20_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

test('dentro una finestra di accesso la domanda del permesso deve arrivare a qualcuno', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  // La pagina dell'accesso: l'indirizzo porta i parametri dell'OAuth, che è la
  // firma con cui Filo riconosce un popup di accesso e lo apre come finestra
  // vera invece che come scheda.
  const urlAccesso = `${testServer.html(ACCESSO)}?client_id=filo&redirect_uri=${encodeURIComponent(testServer.origin)}`;
  const pagina = `<!doctype html><html><body style="margin:0;padding:16px">
<button id="apri">Continua con l'accesso</button>
<script>
  document.getElementById('apri').addEventListener('click', () => {
    window.open(${JSON.stringify(urlAccesso)}, 'accesso', 'width=520,height=640');
  });
</script></body></html>`;

  const page = await testServer.openReady(openTab, pagina);
  const pathAccesso = new URL(urlAccesso).pathname;
  const prima = app.windows().length;

  await page.click('#apri');

  const accesso = await aspetta(async () => app.windows().find((w) => {
    try { return new URL(w.url()).pathname === pathAccesso; } catch (_) { return false; }
  }) || null);
  console.log('[586 g9] finestre aperte:', JSON.stringify(app.windows().map((w) => {
    try { return w.url().slice(0, 80); } catch (_) { return '?'; }
  })), 'prima erano', prima);
  expect(accesso, 'la finestra di accesso non si è aperta: questa prova non riguarda quel caso').toBeTruthy();
  await accesso.waitForLoadState('domcontentloaded').catch(() => {});

  const partito = Date.now();
  const esito = accesso.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => { s.getTracks().forEach((t) => t.stop()); return 'ottenuto'; },
    (e) => 'rifiutato:' + ((e && e.name) || '?'),
  ));

  const comparsa = await aspetta(async () => {
    const n = await shell.locator('.perm-chip').count().catch(() => 0);
    if (n > 0) return 'cornice di Filo';
    const m = await accesso.locator('.perm-chip').count().catch(() => 0);
    if (m > 0) return 'finestra di accesso';
    return null;
  }, 12_000);
  console.log('[586 g9] dove è comparsa la domanda:', comparsa || 'da nessuna parte');

  if (comparsa) {
    const dove = comparsa === 'cornice di Filo' ? shell : accesso;
    await dove.locator('.perm-chip .perm-chip-allow').first().click();
    const r = await esito;
    console.log('[586 g9] dopo il Consenti:', r);
    expect(r, 'la domanda è comparsa ma il «Consenti» non ha dato niente').toBe('ottenuto');
    return;
  }

  const r = await Promise.race([
    esito,
    new Promise((res) => setTimeout(() => res('ancora in attesa'), 20_000)),
  ]);
  console.log('[586 g9] nessuna domanda; esito dopo', Math.round((Date.now() - partito) / 1000), 's:', r);

  expect(
    comparsa,
    'dentro la finestra di accesso che Filo apre per «Continua con…» la domanda del permesso non '
    + 'compare da nessuna parte: né nella cornice di Filo né nella finestra stessa. La richiesta '
    + `resta appesa (${r}) e finisce negata da sola, quindi la fotocamera lì si può solo negare e `
    + 'mai consentire, e chi ci finisce non ha nessun posto in cui rimediare',
  ).toBeTruthy();
});
