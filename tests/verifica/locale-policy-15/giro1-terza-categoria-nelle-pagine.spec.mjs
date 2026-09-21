// Verifica locale, giro 1: la terza categoria della politica sui modelli
// (modelli stretti di produttori indipendenti) arriva davvero a chi legge.
// Prove del giro: non sono guardie permanenti, la suite non le raccoglie.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const URL_PAGINA = 'filo://transparency/transparency.html';

test('la pagina dentro Filo dice tre categorie e nomina il modello ammesso', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  await expect(page.locator('h1')).toHaveText('Politica sui modelli');

  const corpo = page.locator('#doc-body');
  await expect(corpo).toContainText('tre sole categorie');
  await expect(corpo).toContainText('modelli stretti');

  // Il modello ammesso è nominato, con la data di ammissione e quella di
  // revisione: è la promessa centrale della modifica ("elencato per nome, con
  // la data e il motivo, rivalutato a ogni revisione").
  const testo = await corpo.innerText();
  expect(testo).toContain('Jev (TypeSafe)');
  expect(testo).toContain('settembre 2026');
  expect(testo).toContain('dicembre 2026');

  // La terza voce dell'elenco delle categorie esiste come voce di elenco, non
  // solo come frase sparsa nel testo.
  const voci = corpo.locator('ol li');
  const elencate = await voci.allInnerTexts();
  expect(elencate.some((v) => /modelli stretti/i.test(v))).toBe(true);

  // I punti deboli parlano del rischio nuovo (fornitore unico, pesi chiusi):
  // era parte esplicita della richiesta.
  const deboli = await corpo.innerText();
  expect(deboli).toMatch(/pesi chiusi e un fornitore solo/i);
});

test('la stessa cosa la dice la pagina pubblicata sul sito', async () => {
  const html = readFileSync(resolve(RADICE, 'site', 'transparency', 'models.html'), 'utf8');
  expect(html).toContain('tre sole categorie');
  expect(html).toContain('modelli stretti');
  expect(html).toContain('Jev (TypeSafe)');
  expect(html).toContain('dicembre 2026');
  expect(html).not.toContain('due sole categorie');
});

test('la pagina si legge in tema chiaro e in tema scuro', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  for (const schema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: schema });
    const riga = page.locator('#doc-body p', { hasText: 'Jev (TypeSafe)' }).first();
    await expect(riga).toBeVisible();
    // Testo e sfondo non collassano sullo stesso colore.
    const colori = await riga.evaluate((el) => {
      const s = getComputedStyle(el);
      let bg = 'rgba(0, 0, 0, 0)';
      let n = el;
      while (n && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      return { fg: s.color, bg };
    });
    expect(colori.fg).not.toBe(colori.bg);
  }
});
