// Sonda del giro 10 — esplorazione, non ancora una prova da tenere.
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

test('sonda: «Dimentica tutto» del profilo, geometria e conferme', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });

  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Marta\nVive a Lisbona\nLavora in banca\nHa due figli\nParla portoghese',
      PREFERENZE: 'Risposte corte\nNiente emoji',
    });
    await globalThis.SN_FILO_MEMORY.appendLesson('L\'utente non beve caffè');
    await globalThis.SN_FILO_MEMORY.appendLesson('L\'utente preferisce il treno');
  });

  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#memoryBox', { timeout: 20_000 });

  // Quante righe e quanti gruppi
  const gruppi = await page.locator('.mem-group-title').allTextContents();
  console.log('GRUPPI:', JSON.stringify(gruppi));
  console.log('RIGHE:', await page.locator('.mem-line').count());

  // Geometria: il «Dimentica tutto» del primo gruppo e il × della prima riga
  const btn = page.locator('.mem-clear').nth(1); // gruppo "Chi sei" (dopo gli appunti)
  const x1 = page.locator('.mem-line').nth(2).locator('.mem-forget');
  const bBtn = await btn.boundingBox();
  const bX = await x1.boundingBox();
  console.log('BOTTONE DIMENTICA TUTTO:', JSON.stringify(bBtn));
  console.log('× PRIMA RIGA DEL GRUPPO:', JSON.stringify(bX));
  console.log('DISTANZA VERTICALE:', bX.y - (bBtn.y + bBtn.height));
  console.log('SOVRAPPOSIZIONE ORIZZONTALE:',
    Math.min(bBtn.x + bBtn.width, bX.x + bX.width) - Math.max(bBtn.x, bX.x));

  await page.screenshot({ path: resolve(SHOTS, 'giro10-pannello-memoria.png'), fullPage: false });

  // Un clic su «Dimentica tutto» del profilo: chiede qualcosa?
  await btn.click();
  await page.waitForTimeout(1200);
  const dialoghi = await page.evaluate(() => ({
    confirmUi: !!document.querySelector('.sn-confirm, .sn-modal, [role="dialog"]'),
    testo: document.body.innerText.slice(0, 300),
  }));
  console.log('DOPO IL CLIC — dialoghi:', JSON.stringify(dialoghi.confirmUi));
  const dopo = await memoria(app);
  console.log('PROFILO DOPO:', JSON.stringify(dopo.memory.PROFILO));
  console.log('PREFERENZE DOPO:', JSON.stringify(dopo.memory.PREFERENZE));
  console.log('LEZIONI DOPO:', dopo.lessons.length);
  await page.screenshot({ path: resolve(SHOTS, 'giro10-dopo-dimentica-tutto.png') });
});

test('sonda: cancellazione totale a voce, cosa chiede', async ({ app }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta\nVive a Lisbona' });
  });
  const r = await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'CANCELLA_MEMORIA' }, { confirmed: false },
  ));
  console.log('CANCELLA_MEMORIA senza conferma:', JSON.stringify(r).slice(0, 300));
  const liv = await app.evaluate(async () => {
    const L = globalThis.SN_ACTION_LEVELS;
    return {
      memoria: L.levelOf ? L.levelOf({ type: 'CANCELLA_MEMORIA' }) : 'n/d',
      chiavi: Object.keys(L),
    };
  });
  console.log('LIVELLI:', JSON.stringify(liv).slice(0, 300));
});
