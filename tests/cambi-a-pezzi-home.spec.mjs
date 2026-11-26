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
    // La provenienza dipende da chi scriveva prima nella stessa app: conta che sia parola di Filo, fuori dal riquadro.
    expect(p.fuori, quando).toMatch(/^stile dell'agente: {2}· da\S* \S/);
    expect(p.fuori, quando).not.toMatch(/verificato|»/);
    expect(p.filo, quando).toBe('3px');
  };
  await guarda('appena nato');
  id = await riga().getAttribute('data-id');
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
  // Barrata tutta, anche il riquadro.
  await expect.poll(() => riga().locator('.dash-altrui').evaluate((q) => getComputedStyle(q).textDecorationLine), { timeout: 5_000 }).toContain('line-through');

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

// #2662 — il riquadro è un pezzo unico: in una riga tagliata coi puntini, se non ci stava, spariva intero.
test('un valore lungo resta leggibile nella riga del cambio: annullata e a finestra stretta il riquadro si accorcia, non sparisce', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const misura = (riga) => riga.evaluate((r) => {
    const t = r.querySelector('.dash-cambio-testo').getBoundingClientRect();
    const q = r.querySelector('.dash-cambio-testo .dash-altrui').getBoundingClientRect();
    return { fine: Math.round(t.right), riquadro: Math.round(q.right), visto: Math.round(Math.min(t.right, q.right) - q.left) };
  });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ agentStyle: 'Rispondi in modo breve, diretto e senza giri di parole, dammi del tu' }));
  const nata = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(nata).toBeVisible({ timeout: 10_000 });
  const riga = page.locator(`.dash-cambio[data-id="${await nata.getAttribute('data-id')}"]`);
  await riga.hover();
  await riga.locator('.dash-cambio-annulla').click();
  await expect(riga.locator('.dash-cambio-stato')).toHaveText('annullato', { timeout: 10_000 });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs) w.setSize(1000, 760); });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1100);
  await expect.poll(async () => { const m = await misura(riga); return m.riquadro <= m.fine + 1; }, { timeout: 5_000 }).toBe(true);
  const m = await misura(riga);
  expect(m.visto, 'del valore si legge un pezzo').toBeGreaterThan(40);
  expect(await riga.locator('.dash-cambio-testo .dash-altrui').textContent()).toContain('Rispondi in modo breve');
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/cambi-a-pezzi-home-stretta.png' });
});
