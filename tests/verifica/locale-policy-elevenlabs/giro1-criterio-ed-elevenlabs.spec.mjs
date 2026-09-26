// Verifica locale, giro 1: il criterio nuovo dei modelli stretti e l'ammissione
// di ElevenLabs arrivano a chi legge, dentro Filo e sulla pagina pubblicata.
// Prove del giro: non sono guardie permanenti, la suite non le raccoglie.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const URL_PAGINA = 'filo://transparency/transparency.html';

const FRASI_NUOVE = [
  'quello che compro non sia un servizio di quei laboratori',
  'in prodotti che non compro, questo da solo non lo esclude',
  'Conta dove vanno i soldi che pago io',
  'dovrei escludere anche Anthropic',
];
const FRASI_ELEVEN = [
  'ElevenLabs (sintesi vocale, modello Eleven v3), da settembre 2026',
  'solo per la voce del video di presentazione di Filo',
  'la lettura ad alta voce resta a pesi aperti',
  'non addestra modelli linguistici generalisti',
  'nessun laboratorio escluso è fra i suoi soci',
  'rivende modelli di OpenAI e di Google',
  'girano su Google Cloud',
  'SynthID',
  'non risulta se Google venga pagata',
];

function normalizza(s) { return s.replace(/\s+/g, ' '); }

test('dentro Filo la pagina dice il criterio nuovo e ammette ElevenLabs accanto a Jev', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  await expect(page.locator('h1')).toHaveText('Politica sui modelli');
  const corpo = page.locator('#doc-body');
  const testo = normalizza(await corpo.innerText());

  for (const f of FRASI_NUOVE) expect(testo, f).toContain(f);
  expect(testo).not.toMatch(/sotto un altro nome/i);
  for (const f of FRASI_ELEVEN) expect(testo, f).toContain(f);

  // ElevenLabs sta fra Jev e il paragrafo che segue l'elenco degli ammessi.
  const iJev = testo.indexOf('Jev (TypeSafe)');
  const iEleven = testo.indexOf('ElevenLabs (sintesi vocale');
  const iDopo = testo.indexOf('La regola non è');
  expect(iJev).toBeGreaterThan(-1);
  expect(iEleven).toBeGreaterThan(iJev);
  expect(iDopo).toBeGreaterThan(iEleven);

  // Niente numeri di prestazione di Jev nel suo paragrafo.
  const paraJev = normalizza(await corpo.locator('p', { hasText: 'Jev (TypeSafe)' }).first().innerText());
  expect(paraJev).not.toMatch(/\d+\s*%|accuratezza|precisione/i);

  // Le fonti delle riserve sono collegamenti veri, con la loro nota in fondo.
  const pEleven = corpo.locator('p', { hasText: 'ElevenLabs (sintesi vocale' }).first();
  for (const dominio of ['elevenlabs.io', 'prnewswire.com', 'help.elevenlabs.io']) {
    const nota = page.locator(`a[href*="${dominio}"]`);
    expect(await nota.count(), dominio).toBeGreaterThan(0);
  }
  expect(await pEleven.locator('sup a, a').count()).toBeGreaterThan(0);
  const anth = page.locator('a[href*="expanding-our-use-of-google-cloud"]');
  expect(await anth.count()).toBeGreaterThan(0);

  for (const schema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: schema });
    await expect(pEleven).toBeVisible();
    await pEleven.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/policy-elevenlabs-${schema}.png` });
  }
});

test('la pagina pubblicata sul sito e il documento della politica dicono la stessa cosa', async () => {
  const html = normalizza(readFileSync(resolve(RADICE, 'site', 'transparency', 'models.html'), 'utf8')
    .replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  const politica = normalizza(readFileSync(resolve(RADICE, 'filo-model-policy-v1.5.md'), 'utf8'));
  for (const doc of [html, politica]) {
    for (const f of [...FRASI_NUOVE, ...FRASI_ELEVEN]) expect(doc, f).toContain(f);
    expect(doc).not.toMatch(/sotto un altro nome/i);
  }
});
