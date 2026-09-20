// La pagina Opzioni non parla più da sola col fornitore (#591, secondo giro).
//
// La tendina dei modelli si riempiva con una richiesta di rete scritta dentro
// la pagina, che saltava il passaggio unico da cui passa ogni chiamata al
// fornitore. Il catalogo non costa niente, ma quella riga era l'esempio già
// pronto da copiare per la chiamata successiva, che invece si paga.
//
// Qui si verifica il SUCCESSO dal punto di vista di chi usa Opzioni: si preme
// «Aggiorna lista modelli» e la tendina si riempie coi modelli che il fornitore
// ha risposto. Il fornitore è finto e vive nel processo principale: se la
// pagina tornasse a chiamarlo da sé non lo vedrebbe, e la tendina resterebbe
// vuota.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

// Sostituisce il catalogo del fornitore nel processo principale. Torna una
// funzione che rimette a posto.
async function catalogoFinto(app, ids) {
  await app.evaluate(({}, elenco) => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__catalogoVero = P.listCatalog;
    globalThis.__catalogoChiesto = 0;
    P.listCatalog = async () => {
      globalThis.__catalogoChiesto += 1;
      return elenco.map((id) => ({ id, meta: { id } }));
    };
  }, ids);
}

test('Opzioni: la tendina dei modelli si riempie passando dal processo principale', async ({ app, openTab }) => {
  const IDS = ['finto/modello-uno', 'finto/modello-due', 'finto/modello-tre'];
  await catalogoFinto(app, IDS);

  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  await page.click('#loadModels');
  await expect(page.locator('#modelsStatus')).toHaveText(/modelli/, { timeout: 8_000 });

  const opzioni = await page.locator('#models-list-openrouter option').evaluateAll(
    (els) => els.map((e) => e.value),
  );
  for (const id of IDS) {
    expect(opzioni, `«${id}» deve comparire nella tendina`).toContain(id);
  }

  // La richiesta è passata dal processo principale, non dalla pagina.
  const chiesto = await app.evaluate(() => globalThis.__catalogoChiesto);
  expect(chiesto, 'il catalogo va chiesto al processo principale').toBeGreaterThan(0);

  await app.evaluate(() => {
    if (globalThis.__catalogoVero) globalThis.SN_PROVIDER_OPENROUTER.listCatalog = globalThis.__catalogoVero;
  });
});

test('Opzioni: se il fornitore non risponde il campo resta scrivibile e lo dice', async ({ app, openTab }) => {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__catalogoVero = P.listCatalog;
    P.listCatalog = async () => { throw new Error('HTTP 503'); };
  });

  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  await page.click('#loadModels');
  await expect(page.locator('#modelsStatus')).toHaveText(/503/, { timeout: 8_000 });

  // Il campo del modello resta un campo di testo normale: si scrive a mano.
  const campo = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head) .sn-model-id').first();
  await campo.fill('scritto/a-mano');
  expect(await campo.inputValue()).toBe('scritto/a-mano');

  await app.evaluate(() => {
    if (globalThis.__catalogoVero) globalThis.SN_PROVIDER_OPENROUTER.listCatalog = globalThis.__catalogoVero;
  });
});
