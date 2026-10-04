// #873 giro 7, rilievo 1: con l'utente fermo davanti alla home da più di cinque minuti (il sistema lo dà inattivo),
// staccare il caricatore deve cambiare l'icona entro pochi secondi: l'avviso del sistema arriva lo stesso e non costa niente.
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

const COLLEGATA = {
  batteria: { livello: 80, inCarica: false, collegata: true },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: false, dispositivi: [] },
};

test('utente fermo davanti alla home: staccando il caricatore l\'icona passa ad «a batteria»', async ({ app }) => {
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  }, COLLEGATA);
  const page = await newtab(app);
  const batteria = page.locator('#sistema .dash-sis-voce[data-voce="batteria"]');
  await expect(batteria).toHaveAttribute('title', 'Collegata', { timeout: 8_000 });
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);

  // Cinque minuti senza tasti né mouse: il lettore si addormenta, la home resta davanti e guardata.
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.inattivita('idle'));
  await expect.poll(() => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo()), { timeout: giro * 2 + 2_000 }).toBe(false);

  // Si stacca il caricatore: il computer lo dice subito (avviso di sistema) e la lettura lo confermerebbe.
  await app.evaluate(({ powerMonitor }) => {
    globalThis.__sistemaFinto = { ...globalThis.__sistemaFinto, batteria: { livello: 80, inCarica: false, collegata: false } };
    powerMonitor.emit('on-battery');
  });
  await expect(batteria).toHaveAttribute('title', 'A batteria', { timeout: giro + 3_000 });
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.inattivita());
});
