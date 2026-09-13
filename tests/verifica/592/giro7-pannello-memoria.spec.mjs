// Verifica #592, giro 7 — il pannello della memoria, la superficie nata al giro 6.
//
// La quarta cautela del feedback («resta sempre visibile e cancellabile») per le
// lezioni e i moduli di memoria vive tutta qui: una lezione entra SENZA nessuna
// conferma, e la ragione scritta per non chiederla è che l'utente la rilegge e la
// toglie. Quindi questa pagina è, da sola, l'unica barriera di quel pezzo: va
// provata come si prova una barriera.
//
// Cosa si guarda:
//   • una riga lunga e senza spazi (un indirizzo, un id, una frase incollata):
//     resta leggibile per intero e il × resta raggiungibile;
//   • tema chiaro e tema scuro;
//   • il × dice «Dimenticato» anche quando non ha dimenticato niente;
//   • l'altra strada: togliere una riga CHIEDENDOLO a Filo, che è la strada
//     normale di Filo per qualunque cosa.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '..', '..', '.shots');
const PREFERENZE = 'filo://preferences/preferences.html';

const memoria = (app) => app.evaluate(async () => ({
  memory: await globalThis.SN_FILO_MEMORY.getMemory(),
  lessons: await globalThis.SN_FILO_MEMORY.getLessonsBuffer(),
}));

async function apri(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#memoryBox', { timeout: 20_000 });
  return page;
}

test('una riga lunga e senza spazi resta leggibile e il × resta raggiungibile', async ({ app, openTab }) => {
  // 600 caratteri senza un solo spazio: è dentro il tetto di una lezione, quindi
  // Filo può appuntarsela davvero.
  const muro = 'x'.repeat(600);
  await app.evaluate(async (_e, riga) => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: `Vive a Lisbona\n${riga}`,
      PREFERENZE: 'Risposte corte',
    });
  }, muro);

  const page = await apri(openTab);
  const riga = page.locator('.mem-line', { hasText: muro.slice(0, 40) });
  await expect(riga).toHaveCount(1);

  // La pagina non scorre in orizzontale: la riga è andata a capo, non ha sbordato.
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(sborda, 'la pagina scorre in orizzontale per una riga di memoria lunga').toBe(false);

  // Il × di quella riga è cliccabile e dentro la finestra.
  const x = riga.locator('.mem-forget');
  await expect(x).toBeVisible();
  const box = await x.boundingBox();
  const vista = page.viewportSize() || { width: 1280, height: 720 };
  expect(box.x + box.width, 'il × della riga lunga finisce fuori dalla finestra').toBeLessThanOrEqual(vista.width);

  // E funziona: la riga se ne va davvero.
  await x.click();
  await expect(page.locator('#memoryBox')).not.toContainText(muro.slice(0, 40));
  const dopo = await memoria(app);
  expect(dopo.memory.PROFILO).toBe('Vive a Lisbona');
});

test('il pannello della memoria si legge in tema chiaro e in tema scuro', async ({ app, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Vive a Lisbona\nHa due gatti',
      PREFERENZE: 'Risposte corte',
      VIAGGI: 'Vuole andare in Giappone',
    });
    await globalThis.SN_FILO_MEMORY.appendLesson("L'utente non beve caffe");
  });

  for (const tema of ['light', 'dark']) {
    const page = await apri(openTab);
    await page.selectOption('#theme', tema);
    await page.waitForTimeout(500);
    const box = page.locator('#memoryBox');
    await expect(box).toContainText('Ha due gatti');
    await expect(box).toContainText('Viaggi');
    await expect(box).toContainText('non beve caffe');

    // Il testo di una riga si legge sul fondo della pagina: contrasto misurato,
    // non guardato a occhio.
    const contrasto = await page.evaluate(() => {
      const el = document.querySelector('#memoryBox .mem-text');
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
          .map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const fondo = getComputedStyle(document.body).backgroundColor;
      const testo = getComputedStyle(el).color;
      const a = lum(testo); const b = lum(fondo);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrasto, `contrasto troppo basso in tema ${tema}`).toBeGreaterThan(4.5);

    await page.screenshot({ path: `${SHOTS}/giro7-memoria-${tema}.png`, fullPage: false });
  }
});

test('il × dice «Dimenticato» solo se ha dimenticato qualcosa', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Lisbona\nHa due gatti', PREFERENZE: '' });
  });
  const page = await apri(openTab);
  await expect(page.locator('.mem-line', { hasText: 'Ha due gatti' })).toHaveCount(1);

  // Filo riordina il profilo mentre la pagina è aperta e non arriva l'annuncio
  // (il compattatore che riscrive, una scheda rimasta indietro): quello che la
  // pagina mostra non è più vero.
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Porto\nHa tre cani', PREFERENZE: '' });
  });

  await page.locator('.mem-line', { hasText: 'Ha due gatti' }).locator('.mem-forget').click();
  await page.waitForTimeout(600);

  const spia = await page.evaluate(() => {
    const el = document.getElementById('memorySavedHint');
    return { testo: (el.textContent || '').trim(), visibile: el.classList.contains('is-visible') || getComputedStyle(el).opacity !== '0' };
  });
  const dopo = await memoria(app);

  // Niente è stato dimenticato: il profilo è intatto.
  expect(dopo.memory.PROFILO).toBe('Vive a Porto\nHa tre cani');
  // Quindi la pagina non deve dire di averlo fatto.
  expect(spia.visibile && /dimenticato/i.test(spia.testo),
    'la pagina conferma «Dimenticato» senza aver dimenticato niente').toBe(false);
});

test('una riga di memoria si può togliere anche chiedendolo a Filo', async ({ app }) => {
  // In Filo la strada universale è chiedere: la GUI è la scorciatoia, non
  // l'unica porta. Per lo stile dell'agente valgono entrambe (si toglie dalla
  // pagina e a voce). Per una riga di memoria serve la stessa parità: l'unico
  // strumento che oggi tocca la memoria la cancella TUTTA, profilo di mesi
  // compreso, quindi chi chiede «dimentica che non bevo caffè» non ha una
  // strada che faccia solo quello.
  const strumenti = await app.evaluate(async () => Object.keys(globalThis.SN_ACTION_TOOLS.TOOLS || {}));
  const mirati = strumenti.filter((n) => /DIMENTIC|RIMUOVI_LEZION|CANCELLA_LEZION|CANCELLA_RIGA|MEMORIA_RIGA/i.test(n));
  expect(mirati, 'nessuno strumento permette di togliere UNA riga di memoria a voce').not.toHaveLength(0);
});
