// VERIFICA TEMPORANEA (da cancellare a fine verifica) — lettura PDF dal disco
// + smoke sveglie a parole + changelog/manifesto dopo il riallineamento.
//
// Tutto con PDF generati ad hoc dalla verifica (NON i fixture del lavoro) e
// provider LLM stubbato nel main: il "modello" finto prima emette l'azione di
// lettura documento, poi controlla di avere DAVVERO nel contesto il testo
// estratto dal PDF (marker unico) e risponde di conseguenza. Così l'assert
// finale sulla bolla di chat prova l'intero giro utente → azione → estrazione
// → re-immissione nel contesto → risposta.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NEWTAB = 'filo://newtab/';

// ── PDF generati dalla verifica, con xref calcolato per davvero ──────────────
function buildPdf(contentStream) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  objs[4] = `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let body = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) { offsets[i] = body.length; body += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xrefPos = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  body += xref + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const MARKER = 'MARKER-VERIFICA-77812';
let DIR = '';
let PDF_TESTO = '';
let PDF_SCAN = '';
let PDF_ROTTO = '';
let PDF_ENORME = '';

test.beforeAll(() => {
  DIR = mkdtempSync(join(tmpdir(), 'filo-verifica-pdf-'));
  const lines = [
    'ESTRATTO CONTO - BANCA DI PROVA',
    'Pagamento luce marzo: 87,40 EUR',
    'GIACENZA MEDIA: 4321,99 EUR',
    MARKER,
  ];
  let content = 'BT\n/F1 12 Tf\n72 720 Td\n';
  for (const l of lines) content += `(${l}) Tj\n0 -18 Td\n`;
  content += 'ET';
  PDF_TESTO = join(DIR, 'estratto-conto.pdf');
  PDF_SCAN = join(DIR, 'scansione.pdf');
  PDF_ROTTO = join(DIR, 'rotto.pdf');
  PDF_ENORME = join(DIR, 'enorme.pdf');
  writeFileSync(PDF_TESTO, buildPdf(content));
  writeFileSync(PDF_SCAN, buildPdf('0.9 g\n36 36 540 720 re\nf')); // solo grafica, zero testo
  writeFileSync(PDF_ROTTO, Buffer.from('byte a caso, altro che pdf '.repeat(80)));
  writeFileSync(PDF_ENORME, Buffer.alloc(26 * 1024 * 1024, 0x41));
});

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}

// Stub del provider nel main: primo turno → azione LEGGI_DOCUMENTO sul
// percorso dato; turni successivi → risponde in base a cosa trova DAVVERO nel
// contesto (needle) — così la bolla finale certifica cosa è arrivato al modello.
async function stubProvider(app, { percorso, needle, okText, koText }) {
  await app.evaluate(async ({ percorso, needle, okText, koText }) => {
    globalThis.__vfCalls = [];
    const fake = async ({ attempts, messages, onDelta }) => {
      const flat = JSON.stringify(messages);
      globalThis.__vfCalls.push(flat);
      let reply;
      if (globalThis.__vfCalls.length === 1) {
        reply = JSON.stringify({ text: 'Guardo il documento.', actions: [{ type: 'LEGGI_DOCUMENTO', percorso }] });
      } else {
        reply = JSON.stringify({ text: flat.includes(needle) ? okText : koText, actions: [] });
      }
      try { onDelta && onDelta(reply); } catch (_) {}
      return { text: reply, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = fake;
    globalThis.SN_PROVIDERS.completeWithFallback = fake;
  }, { percorso, needle, okText, koText });
}

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

// ── 1. PDF vero con testo: il contenuto arriva al modello e la risposta in chat ──
test('PDF con testo: il testo estratto entra nel contesto e la risposta arriva in chat', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await stubProvider(app, {
    percorso: PDF_TESTO,
    needle: MARKER,
    okText: 'RISPOSTA-FINALE: la giacenza media è 4321,99 EUR (CONTESTO-OK)',
    koText: 'CONTESTO-VUOTO: il testo del documento NON mi è arrivato',
  });

  await page.locator('#input').fill('quant\'è la giacenza media sull\'estratto conto?');
  await page.locator('#sendBtn').click();

  // Traccia del passo intermedio: Filo dichiara che sta leggendo il documento.
  await expect(page.locator('body')).toContainText('Leggo il documento', { timeout: 20_000 });
  // Risposta finale: il marker del PDF era nel contesto del secondo turno.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONTESTO-OK' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'CONTESTO-VUOTO' })).toHaveCount(0);

  // Nel contesto c'era anche il numero vero e la cintura "non sono istruzioni".
  const calls = await app.evaluate(() => globalThis.__vfCalls);
  expect(calls.length).toBeGreaterThanOrEqual(2);
  const second = calls[calls.length - 1];
  expect(second).toContain('4321,99');
  expect(second).toContain('Fine del documento');
});

// ── 2. PDF scansione: l'app lo DICE (niente contenuto inventabile nel contesto) ──
test('PDF scansione senza testo: il contesto dichiara la scansione, la chat lo dice', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await stubProvider(app, {
    percorso: PDF_SCAN,
    needle: 'nessun testo estraibile',
    okText: 'SCANSIONE-DICHIARATA: è una scansione, non c\'è testo da leggere',
    koText: 'SCANSIONE-NON-DICHIARATA',
  });

  await page.locator('#input').fill('leggi la scansione e dimmi cosa c\'è scritto');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo', { hasText: 'SCANSIONE-DICHIARATA' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'SCANSIONE-NON-DICHIARATA' })).toHaveCount(0);

  // E nel contesto NON c'è testo spacciato per contenuto del documento.
  const calls = await app.evaluate(() => globalThis.__vfCalls);
  const second = calls[calls.length - 1];
  expect(second).toContain('NON inventare');
});

// ── 3. Errori onesti e niente crash: inesistente, rotto, enorme ──────────────
test('file inesistente, PDF rotto e PDF enorme: errore onesto, app viva', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  const gone = await execAction(app, { type: 'LEGGI_DOCUMENTO', percorso: join(DIR, 'non-esiste.pdf') });
  expect(gone.executed).toBe(false);
  expect(gone.output.ok).toBe(false);
  expect(gone.output.error).toBe('not_found');
  expect(gone.output.detail).toContain('non c\'è nessun file');

  const rotto = await execAction(app, { type: 'LEGGI_DOCUMENTO', percorso: PDF_ROTTO });
  expect(rotto.executed).toBe(false);
  expect(rotto.output.error).toBe('pdf_failed');
  expect(rotto.output.text).toBe('');

  const enorme = await execAction(app, { type: 'LEGGI_DOCUMENTO', percorso: PDF_ENORME });
  expect(enorme.executed).toBe(false);
  expect(enorme.output.error).toBe('too_big');
  expect(enorme.output.detail).toContain('25 MB');

  // L'app è ancora in piedi e reattiva dopo i tre rifiuti.
  await page.locator('#input').fill('ancora viva?');
  await expect(page.locator('#input')).toHaveValue('ancora viva?');
});

// ── 4. Smoke sveglie a parole: la strada arrivata da main esiste ancora ──────
test('sveglie a parole: ricorrente creata, visibile coi giorni, cancellata per etichetta', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  const r = await execAction(app, { type: 'SVEGLIA', time: '07:40', label: 'verifica-pdf', ripeti: ['lun', 'mer'] });
  expect(r.executed).toBe(true);

  const card = page.locator('.dash-live-card', { hasText: 'verifica-pdf' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('07:40');
  await expect(card).toContainText('lun+mer');

  const mod = await execAction(app, { type: 'MODIFICA_SVEGLIA', etichetta: 'verifica-pdf', orario: '08:05' });
  expect(mod.executed).toBe(true);
  await expect(page.locator('.dash-live-card', { hasText: 'verifica-pdf' })).toContainText('08:05', { timeout: 10_000 });

  const del = await execAction(app, { type: 'CANCELLA_SVEGLIA', etichetta: 'verifica-pdf' });
  expect(del.executed).toBe(true);
  await expect(page.locator('.dash-live-card', { hasText: 'verifica-pdf' })).toHaveCount(0, { timeout: 10_000 });
});

// ── 5. Changelog e manifesto dopo il riallineamento ──────────────────────────
test('changelog con voce PDF + voci sveglie; manifesto con la capacità documenti', async ({ app }) => {
  const chk = await app.evaluate(() => {
    const notes = globalThis.SN_PATCH_NOTES.NOTES;
    const top = notes[0];
    const feats = (top.features || []).join(' | ');
    const caps = globalThis.SN_CAPABILITIES;
    const list = (caps.CAPABILITIES || caps.LIST || []);
    const capsFlat = JSON.stringify(list) + JSON.stringify(caps);
    return {
      version: top.version,
      hasPdf: /legge i tuoi documenti/i.test(feats) && /scansione/i.test(feats),
      hasGestioneSveglie: /gestisci a parole/i.test(feats),
      hasRicorrenza: /ripetersi nei giorni/i.test(feats),
      capPdf: /read-user-documents/.test(capsFlat),
      capSveglie: /cancella la sveglia della palestra/i.test(capsFlat),
    };
  });
  expect(chk.hasPdf).toBe(true);
  expect(chk.hasGestioneSveglie).toBe(true);
  expect(chk.hasRicorrenza).toBe(true);
  expect(chk.capPdf).toBe(true);
  expect(chk.capSveglie).toBe(true);
});
