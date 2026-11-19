// Esplorazione della verifica #2605: il riquadro della rete si chiude quando la pagina sotto scorre davvero, non per
// uno spazio aggiunto né per uno scorrimento finito prima dell'apertura.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app, reti) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    const pc = globalThis.__pc;
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume() { return { ok: true, volume: 25, muto: false, prima: 25 }; },
      async radio(p) { return { ok: true, acceso: p.acceso }; },
      async btElenco() { return { ok: true, acceso: true, dispositivi: [] }; },
      async btCollega() { return { ok: true }; },
      async wifiElenco() { return { ok: true, acceso: true, reti: a.reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome }; },
      async wifiCollega(p) { pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato: PARTENZA, reti });
}

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

// Aggiunge spazio al contenitore che scorre sotto la voce, e ne dice il nome.
const allunga = (page) => voce(page, 'rete').evaluate((el) => {
  let chi = el.parentElement;
  while (chi && chi !== document.body && !/(auto|scroll)/.test(getComputedStyle(chi).overflowY)) chi = chi.parentElement;
  if (!chi || chi === document.body) chi = document.scrollingElement;
  const spazio = document.createElement('div');
  spazio.id = 'spazio-prova';
  spazio.style.cssText = 'height:4000px;flex:0 0 4000px';
  (chi === document.scrollingElement ? document.body : chi).appendChild(spazio);
  window.__chi = chi;
  return chi === document.scrollingElement ? 'documento' : (chi.id || chi.className);
});

async function apri(app, page) {
  await computerFinto(app, ['Casa', ...Array.from({ length: 40 }, (_, i) => `Rete numero ${i + 1}`)]);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
}

test('lo spazio aggiunto senza scorrere non chiude il riquadro', async ({ app }) => {
  const page = await home(app);
  await apri(app, page);
  await voce(page, 'rete').click();
  await expect(riquadro(page)).toBeVisible({ timeout: 5_000 });
  console.log('contenitore:', await allunga(page));
  await page.waitForTimeout(800);
  await expect(riquadro(page)).toHaveCount(1);
});

test('la rotella sulla pagina fuori dal riquadro, che la fa scorrere, lo chiude', async ({ app }) => {
  const page = await home(app);
  await apri(app, page);
  await allunga(page);
  await voce(page, 'rete').click();
  await expect(riquadro(page)).toBeVisible({ timeout: 5_000 });
  const b = await riquadro(page).boundingBox();
  const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const x = b.x > 120 ? 40 : Math.min(vp.width - 40, b.x + b.width + 60);
  await page.mouse.move(x, Math.min(vp.height - 40, b.y + 20));
  const prima = await page.evaluate(() => window.__chi.scrollTop);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.__chi.scrollTop)).toBeGreaterThan(prima);
  await expect(riquadro(page)).toHaveCount(0);
});

test('uno scorrimento finito prima dell\'apertura non lo chiude', async ({ app }) => {
  const page = await home(app);
  await apri(app, page);
  await allunga(page);
  await page.evaluate(() => window.__chi.scrollBy({ top: 30, behavior: 'instant' }));
  await voce(page, 'rete').click();
  await expect(riquadro(page)).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(800);
  await expect(riquadro(page)).toHaveCount(1);
});
