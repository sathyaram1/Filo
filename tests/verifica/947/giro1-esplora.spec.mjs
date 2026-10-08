// #947 giro 1: la richiesta della segnalazione sulle cartelle vere dell'utente (Documenti annidati, Scrivania), un nome
// di file con markup, e un file messo nella cartella subito dopo una ricerca.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaDellaProva, BOLLETTA_MARZO, pdf } from '../../helpers/documentiFinti.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RICHIESTA = 'Mi serve la bolletta della luce di marzo. Dov\'è?';

async function cartelleDiSerie(app) {
  const doc = cartellaTemporanea('filo-947-doc-');
  const scr = cartellaTemporanea('filo-947-scr-');
  await app.evaluate((_e, [d, s]) => {
    process.env.FILO_DOCUMENTI_DIR = d;
    process.env.FILO_SCRIVANIA_DIR = s;
    globalThis.SN_DOCUMENTI_INDICE._azzera();
  }, [doc, scr]);
  return { doc, scr };
}

test('la bolletta in Documenti, tre cartelle sotto, è il file della risposta', async ({ app }) => {
  test.setTimeout(90_000);
  const { doc, scr } = await cartelleDiSerie(app);
  const dir = join(doc, 'Casa', '2026', 'varie');
  cartellaDellaProva(dir);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'bolletta luce marzo energia elettrica' }) }] },
      { text: `È ${BOLLETTA_MARZO}, in Documenti/Casa/2026/varie: è la bolletta dell'energia elettrica di marzo 2026.` },
    ]);
    const page = await home(app);
    await chiedi(page, RICHIESTA);
    const file = page.locator('.dash-bubble-actions .dash-file-btn');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file).toHaveAttribute('data-percorso', join(dir, BOLLETTA_MARZO));
    const esito = JSON.stringify((await chiamateAlModello(app))[1]);
    expect(esito).toContain(`1. ${BOLLETTA_MARZO}`);
  } finally {
    await ripristina(app);
    rmSync(doc, { recursive: true, force: true });
    rmSync(scr, { recursive: true, force: true });
  }
});

test('un nome di file con markup ed emoji resta testo nel bottone e nell\'attesa', async ({ app }) => {
  test.setTimeout(90_000);
  const { doc, scr } = await cartelleDiSerie(app);
  const nome = '<img src=x onerror="window.__xss=1">🧾 garanzia.txt';
  writeFileSync(join(scr, nome), 'Certificato di garanzia lavatrice, due anni dalla data di acquisto.');
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'garanzia lavatrice' }) }] },
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: join(scr, nome) }) }] },
      { text: 'Eccola, sulla Scrivania.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'è la garanzia della lavatrice?');
    const file = page.locator('.dash-bubble-actions .dash-file-btn');
    await expect(file.locator('.dash-file-btn-nome')).toHaveText(nome, { timeout: 20_000 });
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  } finally {
    await ripristina(app);
    rmSync(doc, { recursive: true, force: true });
    rmSync(scr, { recursive: true, force: true });
  }
});

test('un file salvato in Documenti subito dopo una ricerca vuota si trova chiedendo di nuovo', async ({ app }) => {
  test.setTimeout(90_000);
  const { doc, scr } = await cartelleDiSerie(app);
  const fuori = cartellaTemporanea('filo-947-fuori-');
  writeFileSync(join(fuori, 'scan_00777.pdf'), pdf([[
    'ENERGIA SERVIZIO ELETTRICO S.p.A.', 'Bolletta per la fornitura di energia elettrica',
    'Periodo di fatturazione: 01/03/2026 - 31/03/2026', 'Consumo del periodo: 212 kWh',
  ]]));
  try {
    const I = (q) => app.evaluate((_e, x) => globalThis.SN_DOCUMENTI_INDICE.cerca(x), q);
    const prima = await I('bolletta luce marzo');
    expect(prima.risultati.length).toBe(0);
    // L'utente la salva in Documenti (dalla posta, dallo scanner, trascinandola) e richiede.
    renameSync(join(fuori, 'scan_00777.pdf'), join(doc, 'scan_00777.pdf'));
    const dopo = await I('bolletta luce marzo');
    expect(dopo.risultati.map((r) => r.nome)).toContain('scan_00777.pdf');
  } finally {
    rmSync(doc, { recursive: true, force: true });
    rmSync(scr, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});
