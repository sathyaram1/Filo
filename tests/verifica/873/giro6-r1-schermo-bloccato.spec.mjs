// #873 giro 6 — con lo schermo bloccato la home davanti non deve tenere sveglio il lettore del computer.
// Il blocco si simula con l'avviso del sistema (powerMonitor 'lock-screen'): nel contenitore non c'è una sessione da bloccare.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la home non si è aperta');
}

const PIENO = {
  batteria: { livello: 42, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa di Anna' },
  bluetooth: { acceso: true, dispositivi: ['Cuffie'] },
};

test('schermo bloccato con la home davanti: il lettore si ferma, e allo sblocco riparte', async ({ app }) => {
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  }, PIENO);
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.veglia(2_000));
  const page = await newtab(app);
  const attivo = () => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo());
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);
  await expect.poll(attivo, { timeout: 8_000 }).toBe(true);

  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('lock-screen'); });
  // La home davanti continua a chiedere come fa il suo richiamo di ogni mezzo minuto (qui più spesso della veglia).
  await page.evaluate(() => {
    const fine = Date.now() + 20_000;
    window.__chiedeSempre = true;
    (async () => {
      while (window.__chiedeSempre && Date.now() < fine) {
        await window.filo.message({ type: window.SN_MSG.MSG.SISTEMA_STATO }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1_000));
      }
    })();
  });
  await expect.poll(attivo, { timeout: 2_000 + giro * 2 + 3_000 }).toBe(false);
  await page.evaluate(() => { window.__chiedeSempre = false; });
  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('unlock-screen'); });
  await expect.poll(attivo, { timeout: 2_000 }).toBe(true);
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.veglia(0));
});
