// Esplorazione giro 4 — la fotocamera accesa: si vede? si spegne?
//
// Per la ripresa dello schermo Filo mostra un segno mentre è in corso e dà un
// «Interrompi». Per fotocamera e microfono niente: né un segno che sono
// accesi, né un modo di fermarli. E la revoca fatta in Impostazioni non tocca
// quello che il sito ha già in mano.
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<video id="v" autoplay muted></video>
<script>
  window.__tracce = null;
  window.__chiedi = (v, a) => navigator.mediaDevices.getUserMedia({ video: !!v, audio: !!a }).then(
    (s) => { window.__tracce = s.getTracks(); document.getElementById('v').srcObject = s;
      return s.getTracks().map((t) => t.kind + ':' + t.readyState); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__stato = () => (window.__tracce || []).map((t) => t.kind + ':' + t.readyState + ':' + t.enabled);
  // Qualche fotogramma davvero arrivato: la prova che la fotocamera vede.
  window.__fotogrammi = () => { const v = document.getElementById('v');
    return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight }; };
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

test('fotocamera e microfono accesi: che segno c\'è, e cosa fa la revoca', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__chiedi(true, true));
  const chip = shell.locator('.perm-chip');
  await chip.first().waitFor({ timeout: 20_000 });
  console.log('[586 g4] domanda:', JSON.stringify(await chip.first().textContent()));
  await chip.locator('.perm-chip-allow').first().click();
  console.log('[586 g4] tracce ottenute:', JSON.stringify(await esito));
  await page.waitForTimeout(1500);
  console.log('[586 g4] fotogrammi arrivati:', JSON.stringify(await page.evaluate(() => window.__fotogrammi())));

  // C'è un segno, nella cornice, che la fotocamera e il microfono sono accesi?
  const segni = await shell.evaluate(() => ({
    live: document.querySelectorAll('.perm-live').length,
    testoLive: [...document.querySelectorAll('.perm-live')].map((n) => n.textContent),
    chip: document.querySelectorAll('.perm-chip').length,
    scheda: [...document.querySelectorAll('.tab')].map((n) => n.textContent.trim()).slice(0, 5),
  }));
  console.log('[586 g4] segni nella cornice mentre fotocamera+microfono sono accesi:', JSON.stringify(segni));

  // Ora la revoca dalle Impostazioni, come chiede il feedback.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  const righe = await sicurezza.locator('#perms-list li').allTextContents();
  console.log('[586 g4] elenco in Impostazioni:', JSON.stringify(righe));
  const riga = () => sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  // Il × toglie la voce: prima la fotocamera, poi il microfono.
  while (await sicurezza.locator('#perms-list li').filter({ hasText: host }).count()) {
    const x = riga().locator('button[aria-label]').first();
    if (!(await x.count())) break;
    await x.click();
    await sicurezza.waitForTimeout(600);
  }
  await sicurezza.waitForTimeout(1200);
  console.log('[586 g4] elenco dopo la revoca:', JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));

  await page.waitForTimeout(1500);
  console.log('[586 g4] DOPO LA REVOCA — tracce:', JSON.stringify(await page.evaluate(() => window.__stato())));
  const prima = await page.evaluate(() => window.__fotogrammi());
  await page.waitForTimeout(1500);
  const dopo = await page.evaluate(() => window.__fotogrammi());
  console.log('[586 g4] DOPO LA REVOCA — il video va ancora avanti?', JSON.stringify({ prima, dopo, avanza: dopo.t > prima.t }));
});
