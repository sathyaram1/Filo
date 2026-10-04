// #873 giro 8, rilievo 1: con l'utente fermo davanti alla home (il sistema lo dà inattivo) la batteria che scende
// deve vedersi lo stesso: percentuale e avviso di batteria bassa seguono il computer, non il momento in cui si è fermato.
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

const A_BATTERIA = (livello) => ({
  batteria: { livello, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: false, dispositivi: [] },
});

test('utente fermo davanti alla home: la batteria che scende si vede, fino all\'avviso di batteria bassa', async ({ app }) => {
  test.setTimeout(150_000);
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  }, A_BATTERIA(20));
  const page = await newtab(app);
  const batteria = page.locator('#sistema .dash-sis-voce[data-voce="batteria"]');
  await expect(batteria).toHaveText('20%', { timeout: 8_000 });
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);

  // Cinque minuti senza tasti né mouse (segue un lavoro lungo di Filo): la home resta davanti, guardata.
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.inattivita('idle'));
  await expect.poll(() => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo()), { timeout: giro * 2 + 2_000 }).toBe(false);

  // Intanto la batteria scende sotto la soglia di batteria bassa, senza nessun avviso del caricatore.
  await app.evaluate(() => { globalThis.__sistemaFinto = { ...globalThis.__sistemaFinto, batteria: { livello: 12, inCarica: false, collegata: false } }; });
  try {
    await expect(batteria).toHaveText('12%', { timeout: 75_000 });
    await expect(batteria).toHaveAttribute('data-stato', 'bassa');
  } finally {
    await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.inattivita());
  }
});
