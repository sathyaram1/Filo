// Verifica #586, giro 8 — una videochiamata chiede fotocamera E microfono
// insieme, e chi naviga più tardi ne toglie UNA sola.
//
// Per chi usa Filo: su un sito di videochiamata compare una domanda sola,
// «vuole usare la fotocamera e il microfono», e tu consenti. Restano scritte due
// risposte distinte, come devono. Poi cambi idea sulla webcam: vai in
// Impostazioni → Sicurezza e togli la Fotocamera, lasciando il Microfono.
//
// Quello che deve succedere: la webcam si spegne subito, la voce resta viva (la
// telefonata non cade), il cartello sotto le schede smette di nominare la
// fotocamera e continua a nominare il microfono, e la pagina non riparte da zero
// portandosi via quello che c'era scritto dentro. Togliere una cosa sola deve
// togliere una cosa sola.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<input id="campo" style="width:80%">
<script>
  window.__vivo = String(Date.now());
  window.__tracce = [];
  window.__chiedi = () => navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
    (s) => { window.__tracce.push(...s.getTracks()); return s.getTracks().map((t) => t.kind + ':' + t.readyState).sort(); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__stato = () => window.__tracce.map((t) => t.kind + ':' + t.readyState).sort();
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

test('togliere la sola fotocamera non deve portare via anche il microfono, né la pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__chiedi());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  console.log('[586 g8] la domanda dice:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito, 'chi consente deve ottenere webcam e microfono').toEqual(['audio:live', 'video:live']);

  await page.fill('#campo', 'quello che stavo scrivendo');
  const vivoPrima = await page.evaluate(() => window.__vivo);
  console.log('[586 g8] cartello con tutte e due:',
    JSON.stringify(await shell.locator('.perm-live').allTextContents()));

  // Impostazioni → Sicurezza: si toglie SOLO la fotocamera.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  console.log('[586 g8] elenco in Impostazioni:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));

  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  const gruppoCam = riga.locator('span').filter({ hasText: /^Fotocamera/ }).first();
  await gruppoCam.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(2000);
  console.log('[586 g8] elenco dopo aver tolto la fotocamera:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));

  await page.waitForTimeout(1500);
  const stato = await page.evaluate(() => window.__stato());
  const vivoDopo = await page.evaluate(() => window.__vivo);
  const campo = await page.inputValue('#campo').catch(() => '');
  const cartelli = await shell.locator('.perm-live').allTextContents();
  console.log('[586 g8] tracce dopo:', JSON.stringify(stato), 'cartelli:', JSON.stringify(cartelli),
    'pagina ricaricata:', vivoDopo !== vivoPrima, 'campo:', JSON.stringify(campo));

  expect(
    stato,
    'tolta la sola fotocamera, la webcam deve spegnersi e il microfono restare acceso: '
    + 'chi toglie la webcam a una videochiamata non si aspetta che cada anche la voce',
  ).toEqual(['audio:live', 'video:ended']);

  expect(
    vivoDopo,
    'togliere un permesso ha fatto ripartire la pagina da zero: quello che chi naviga stava '
    + 'scrivendo lì è perso',
  ).toBe(vivoPrima);
  expect(campo, 'il campo si è svuotato').toBe('quello che stavo scrivendo');

  expect(
    cartelli.join(' | '),
    'il cartello continua a dire che il sito può usare la fotocamera, che gli è appena stata tolta',
  ).not.toMatch(/fotocamera/i);
  expect(
    cartelli.join(' | '),
    'il microfono è ancora aperto e il cartello che lo dice è sparito: resta acceso senza nessun segno',
  ).toMatch(/microfono/i);
});
