// Verifica #950, giro 1, rilievo 1: in chat (file trovato da Filo, file trascinato dove si scrive) il nome di
// prima si deve poter rimettere anche dopo che il riquadro con «Annulla» si è chiuso, come negli Scaricamenti.

import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

function pdfConTesto(righe) {
  const corpo = righe.map((r, i) => `${i ? '0 -24 Td\n' : ''}(${r}) Tj`).join('\n');
  const stream = `BT\n/F1 14 Tf\n40 700 Td\n${corpo}\nET\n`;
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const pos = [];
  oggetti.forEach((o, i) => { pos.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const BOLLETTA = pdfConTesto(['Bolletta luce Enel', 'Marzo 2026']);
const NUOVO = 'Bolletta luce Enel Marzo 2026.pdf';

async function modelloDeiNomi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => (
      { text: 'Bolletta luce Enel Marzo 2026', model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
}

async function rinominaDalRiquadro(page) {
  await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
  await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
  await page.locator('.sn-rinomina-ok').click();
  await expect(page.locator('.sn-rinomina-esito-testo')).toContainText('Rinominato');
  // Un clic altrove, come fa chiunque dopo aver visto il nome nuovo: il riquadro con «Annulla» se ne va.
  await page.mouse.click(5, 5);
  await expect(page.locator('.sn-rinomina')).toHaveCount(0);
}

async function rimettiDalMenu(page, ancora) {
  await ancora.click({ button: 'right' });
  const voce = page.locator('.sn-rinomina-menu .sn-select-option', { hasText: /Rimetti|nome di prima|Annulla/ });
  await expect(voce, 'dal tasto destro si rimette il nome di prima').toBeVisible({ timeout: 5000 });
  await voce.click();
}

test('file trovato in chat: rinominato e chiuso il riquadro, il nome di prima si rimette dal tasto destro', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-r1-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vecchio, etichetta: 'scan_00231.pdf' }) }] },
      { text: 'Eccolo.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'trova la bolletta');
    const chip = page.locator('a.dash-action-btn').first();
    await expect(chip).toHaveText('scan_00231.pdf', { timeout: 15000 });
    await chip.click({ button: 'right' });
    await rinominaDalRiquadro(page);
    expect(existsSync(join(dir, NUOVO))).toBe(true);

    await rimettiDalMenu(page, chip);
    await expect.poll(() => existsSync(vecchio) && !existsSync(join(dir, NUOVO)), { timeout: 10000 }).toBe(true);
    await expect(chip).toHaveText('scan_00231.pdf');
    await page.screenshot({ path: join(process.cwd(), 'tests', '.shots', 'v950-rimesso-chat.png') });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file trascinato dove si scrive: rinominato e chiuso il riquadro, il nome di prima si rimette dal tasto destro', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-r1-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await modelloFinto(app, [{ text: 'Ricevuto.' }]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await page.evaluate((p) => {
      window.filo.percorsoDelFile = () => p;
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF'], 'scan_00231.pdf', { type: 'application/pdf' }));
      document.getElementById('inputForm').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, vecchio);
    const chip = page.locator('.dash-file-chip');
    await expect(chip).toHaveText(/scan_00231\.pdf/);
    await chip.click({ button: 'right' });
    await rinominaDalRiquadro(page);
    expect(existsSync(join(dir, NUOVO))).toBe(true);

    await rimettiDalMenu(page, chip);
    await expect.poll(() => existsSync(vecchio) && !existsSync(join(dir, NUOVO)), { timeout: 10000 }).toBe(true);
    await expect(page.locator('.dash-file-chip')).toHaveText(/scan_00231\.pdf/);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
