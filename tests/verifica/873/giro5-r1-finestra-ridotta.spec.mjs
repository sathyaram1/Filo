// Giro 5, rilievo 1: con la finestra di Filo ridotta a icona (o nascosta) la home, scheda attiva, continua a
// tenere sveglio il lettore del computer. Nel contenitore non c'è un gestore di finestre: se ridurre non riesce,
// la finestra si nasconde, che per la pagina è la stessa cosa (resta «visible»).
import { test, expect } from '../../fixtures/electron.mjs';

test('con la finestra ridotta a icona la home non tiene sveglio il lettore', async ({ app }) => {
  await app.evaluate(async () => {
    globalThis.__sistemaFinto = {
      batteria: { livello: 42, inCarica: false, collegata: false },
      rete: { online: true, tipo: 'wifi', nome: 'Casa' },
      bluetooth: { acceso: true, dispositivi: [] },
    };
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
    globalThis.SN_SISTEMA_MAIN._perProve.veglia(2_000);
  });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((x) => x.url().startsWith('filo://newtab')) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  const attivo = () => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo());
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);
  await expect.poll(attivo, { timeout: 8_000 }).toBe(true);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.minimize();
    if (!w.isMinimized()) w.hide();
  });
  // La home ridotta continua a chiedere come fa ogni 30 secondi (per la pagina resta visibile): qui più spesso
  // della veglia, come il richiamo vero lo è dei 90 secondi veri. Chi chiede da una finestra che nessuno vede
  // riceve lo stato, ma il lettore si addormenta.
  await page.evaluate(() => {
    const fine = Date.now() + 20_000;
    (async () => {
      while (Date.now() < fine) {
        await window.filo.message({ type: window.SN_MSG.MSG.SISTEMA_STATO }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1_000));
      }
    })();
  });
  await expect.poll(attivo, { timeout: 2_000 + giro * 2 + 3_000 }).toBe(false);
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.veglia(0));
});
