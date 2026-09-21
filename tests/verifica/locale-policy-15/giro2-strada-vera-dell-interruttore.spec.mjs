// Verifica locale, giro 2: la terza categoria passa dalla STRADA VERA, non solo
// dalle funzioni pure. L'interruttore si accende come lo accende chi usa Filo, e
// si guarda cosa finisce davvero nella richiesta e nel riscontro a risposta
// arrivata. Prove del giro: non sono guardie permanenti.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function conInterruttore(app, acceso) {
  return app.evaluate(async (_electron, on) => {
    const S = globalThis.__filoStorage;
    const cur = (await S.get('settings')).settings || {};
    await S.set({ settings: { ...cur, openWeightsOnly: on } });
    const eff = await globalThis.__filoHandlers.getEffectiveSettings();
    const C = globalThis.SN_CONST;
    const esclusi = eff.excludedProviders || [];
    return {
      openWeightsOnly: eff.openWeightsOnly === true,
      esclusi: esclusi.map((x) => String(x).toLowerCase()),
      // Quello che viaggia DAVVERO con ogni richiesta OpenRouter.
      ignore: C.providerIgnoreList(esclusi).map((x) => String(x).toLowerCase()),
      // Quello che decide l'avviso a schermo e il marchio in cronologia se una
      // risposta arrivasse da quel produttore.
      violazione: C.isProviderExcluded('TypeSafe', esclusi),
    };
  }, acceso);
}

test('acceso davvero nelle impostazioni, il nome del produttore stretto viaggia con la richiesta', async ({ app }) => {
  const acceso = await conInterruttore(app, true);
  expect(acceso.openWeightsOnly).toBe(true);
  expect(acceso.esclusi).toContain('typesafe');
  expect(acceso.esclusi).toContain('anthropic');
  expect(acceso.ignore).toContain('typesafe');
  // Se la risposta arrivasse comunque da lì, l'utente lo vede.
  expect(acceso.violazione).toBe(true);

  const spento = await conInterruttore(app, false);
  expect(spento.openWeightsOnly).toBe(false);
  // Spento il modello stretto è ammesso: è il senso della terza categoria.
  expect(spento.esclusi).not.toContain('typesafe');
  expect(spento.ignore).not.toContain('typesafe');
  expect(spento.violazione).toBe(false);
  // E i laboratori esclusi restano esclusi in ogni caso.
  expect(spento.esclusi).toContain('openai');
  expect(spento.esclusi).toContain('google');
});

test('il testo che Filo legge quando gli chiedi dei modelli dice la terza categoria', async ({ app }) => {
  const testo = await app.evaluate(() => globalThis.SN_TRANSPARENCY.asText('models'));
  expect(testo).toContain('tre sole categorie');
  expect(testo).toMatch(/modelli stretti/i);
  expect(testo).toContain('Jev (TypeSafe)');
  expect(testo).toContain('settembre 2026');
  expect(testo).toContain('dicembre 2026');
  expect(testo).not.toContain('due sole categorie');
});

test('pagina dentro Filo e pagina pubblicata raccontano la stessa terza categoria', async ({ openTab }) => {
  const page = await openTab('filo://transparency/transparency.html');
  const dentro = (await page.locator('#doc-body').innerText()).replace(/\s+/g, ' ');

  const html = readFileSync(resolve(RADICE, 'site', 'transparency', 'models.html'), 'utf8');
  const fuori = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ');

  // Le frasi che portano la promessa: se una delle due rese le perde, chi legge
  // solo quella non sa cosa è stato promesso all'altro.
  const promesse = [
    'elencato qui sotto per nome',
    'resta sempre una strada a pesi aperti',
    'spegne anche questi',
    'pesi chiusi e un fornitore solo',
    'ogni ammissione ha una scadenza',
  ];
  for (const frase of promesse) {
    expect(dentro.toLowerCase(), `manca dentro Filo: ${frase}`).toContain(frase);
    expect(fuori.toLowerCase(), `manca sulla pagina pubblicata: ${frase}`).toContain(frase);
  }
});
