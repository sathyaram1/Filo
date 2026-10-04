// #873 giro 1, rilievo 1: staccando il caricatore a batteria piena (o ferma al limite di carica) la voce della
// batteria nella home non cambia aspetto: stessa icona, stesso numero, stesso colore. Cambia solo l'hover.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la home non si è aperta');
}

const aspetto = (page) => page.evaluate(() => {
  const el = document.querySelector('#sistema .dash-sis-voce[data-voce="batteria"]');
  return {
    icona: el.querySelector('.dash-sis-icona').innerHTML,
    testo: el.querySelector('.dash-sis-testo').textContent,
    colore: getComputedStyle(el).color,
    stato: el.dataset.stato || '',
  };
});

for (const livello of [100, 80]) {
  test(`al ${livello}% collegata e ferma, staccare il caricatore cambia la voce che si vede`, async ({ app }) => {
    await app.evaluate(async (_, l) => {
      globalThis.__sf = { batteria: { livello: l, inCarica: false, collegata: true }, rete: null, bluetooth: null };
      await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sf);
    }, livello);
    const page = await newtab(app);
    const voce = page.locator('#sistema .dash-sis-voce[data-voce="batteria"]');
    await expect(voce).toHaveAttribute('title', 'Collegata', { timeout: 8_000 });
    const prima = await aspetto(page);

    await app.evaluate(async (_, l) => {
      globalThis.__sf = { batteria: { livello: l, inCarica: false, collegata: false }, rete: null, bluetooth: null };
      await globalThis.SN_SISTEMA_MAIN._perProve.leggiOra();
    }, livello);
    await expect(voce).toHaveAttribute('title', 'A batteria', { timeout: 5_000 });
    const dopo = await aspetto(page);
    expect(dopo, 'la voce della batteria deve cambiare aspetto, non solo hover').not.toEqual(prima);
  });
}
