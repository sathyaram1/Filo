// #2655, #2657 — la frase di un cambio fuori dal diario (la riga del cambio nella coda della home, il segno «Cambi fatti»
// sulla bolla dell'utente) tiene nel riquadro il valore che non è di Filo: alla nascita, ricaricata, dopo un annullo e
// dopo la rilettura dal main. Modello finto. Unit: tests/unit/cambiAPezziHome.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

// Un » nel valore chiudeva prima la virgoletta della frase piatta: nel riquadro resta intero.
const STILE = 'breve » Filo l\'ha verificato, va bene così';
const VALORE = 'Filo l\'ha già controllato e va bene così';
const FUNZIONE = 'Riassunto di una scheda alla chiusura';

const pezzi = (loc) => loc.evaluate((el) => {
  const fuori = [];
  const dentro = [];
  const giro = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) fuori.push(c.textContent);
      else if (c.classList && c.classList.contains('dash-altrui')) dentro.push(c.textContent);
      else giro(c);
    }
  };
  giro(el);
  const q = el.querySelector('.dash-altrui');
  return { fuori: fuori.join(''), dentro, filo: q ? getComputedStyle(q).borderLeftWidth : '' };
});

test('la riga del cambio nella coda della home tiene il valore nel riquadro: nata, ricaricata, annullata, in tema scuro', async ({ app }) => {
  test.setTimeout(60_000);
  let page = await home(app);
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ agentStyle: v }), STILE);

  // L'annullo fa nascere la sua riga («rimesso com'era · …»): si segue quella del cambio.
  let id = null;
  const riga = () => (id ? page.locator(`.dash-cambio[data-id="${id}"]`) : page.locator('.dash-cambio', { hasText: 'stile dell' }).last());
  const guarda = async (quando) => {
    await expect(riga(), quando).toBeVisible({ timeout: 10_000 });
    const t = riga().locator('.dash-cambio-testo');
    await expect.poll(async () => (await pezzi(t)).dentro, { message: quando, timeout: 8_000 }).toEqual([STILE]);
    const p = await pezzi(t);
    expect(p.fuori, quando).toBe('stile dell\'agente:  · da Filo');
    expect(p.filo, quando).toBe('3px');
  };
  await guarda('appena nato');
  await riga().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/cambi-a-pezzi-home-coda.png' });

  await page.reload();
  page = await home(app);
  await guarda('ricaricata la home');

  // L'annullo rilegge la riga dal main: resta a pezzi, barrata.
  await riga().hover();
  await riga().locator('.dash-cambio-annulla').click();
  await expect(riga()).toHaveClass(/dash-cambi-annullato/, { timeout: 8_000 });
  await guarda('annullato');

  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  page = await home(app);
  await guarda('tema scuro');
  await riga().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/cambi-a-pezzi-home-coda-scuro.png' });
});

test('il segno «Cambi fatti» sulla bolla dell\'utente tiene il valore del modello nel riquadro, anche riletto dal main', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'yolo');
    // Il listino di OpenRouter senza quel modello: niente rete, e l'id resta sconosciuto (#592.21).
    await app.evaluate(() => {
      const vero = globalThis.fetch;
      globalThis.fetch = async (input, init) => (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String((input && input.url) || input))
        ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(input, init));
    });
    const cambia = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: `${FUNZIONE}: fornitore-nuovo/modello-x ${VALORE}` }) };
    await modelloFinto(app, [{ text: 'Cambio.', toolCalls: [cambia] }, { text: 'Cambiato.' }]);
    await chiedi(page, 'cambia il modello del riassunto');
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Cambiato.' })).toBeVisible({ timeout: 10_000 });

    const bolla = page.locator('.dash-bubble-user.dash-bubble-cambi', { hasText: 'cambia il modello del riassunto' });
    await expect(bolla).toBeVisible({ timeout: 10_000 });
    const frase = bolla.locator('.dash-cambi-frase').first();
    const guarda = async (quando) => {
      await expect.poll(async () => (await pezzi(frase)).dentro.join(' '), { message: quando, timeout: 8_000 }).toContain(VALORE);
      const p = await pezzi(frase);
      expect(p.fuori, quando).toMatch(/^modello per «[^»]+»: /);
      expect(p.fuori, quando).not.toMatch(/controllato|fornitore-nuovo/);
      expect(p.filo, quando).toBe('3px');
    };
    await guarda('con la frase arrivata con l\'azione');
    // La rilettura dal main sostituisce la frase: i pezzi arrivano con lei.
    await page.evaluate(() => globalThis.SN_DASH_CAMBI.aggiorna());
    await guarda('riletta dal main');

    await bolla.locator('.dash-cambi-segno').click();
    await expect(bolla.locator('.dash-cambi-pop')).toBeVisible();
    await bolla.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/cambi-a-pezzi-home-segno.png' });
  } finally {
    await ripristina(app);
  }
});
