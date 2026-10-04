// Esplorazione del giro 3 di #950: immagine, PDF grande, tema scuro, la chat dopo una rinomina dal tasto destro.
import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { confirmText, clickConfirm } from '../../helpers/confirm.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

function pdfConTesto(righe, zavorra = 0) {
  const corpo = righe.map((r, i) => `${i ? '0 -24 Td\n' : ''}(${r}) Tj`).join('\n');
  const stream = `BT\n/F1 14 Tf\n40 700 Td\n${corpo}\nET\n`;
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  if (zavorra) oggetti.push(`<< /Length ${zavorra} >>\nstream\n${'A'.repeat(zavorra)}\nendstream`);
  let out = '%PDF-1.4\n';
  const pos = [];
  oggetti.forEach((o, i) => { pos.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n` + pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function modelloDeiNomi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__nomiVisti = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const img = Array.isArray(u.content) && u.content.some((p) => p.type === 'image_url');
      const testo = typeof u.content === 'string' ? u.content : u.content.map((p) => p.text || '').join('\n');
      globalThis.__nomiVisti.push({ img, testo });
      const m = /Nome attuale:[^\n]*\n\n([^\n]+)\n([^\n]+)/.exec(testo);
      return { text: img ? 'Foto gatto sul divano' : (m ? `${m[1]} ${m[2]}` : 'NESSUN NOME'), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

async function chipDi(app, percorso, etichetta) {
  await modelloFinto(app, [
    { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso, etichetta }) }] },
    { text: 'Eccolo.' },
    { text: 'Fatto.' },
  ]);
  await modelloDeiNomi(app);
  const page = await home(app);
  await chiedi(page, 'trova il file');
  const chip = page.locator('a.dash-action-btn', { hasText: etichetta });
  await expect(chip).toBeVisible({ timeout: 15000 });
  return { page, chip };
}

test('immagine PNG dal tasto destro in chat', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-esp-img-');
  const p = join(dir, 'IMG_20260301_1012.png');
  const png = await app.evaluate(({ nativeImage }) => {
    const w = 64, h = 64; const b = Buffer.alloc(w * h * 4, 200);
    return nativeImage.createFromBitmap(b, { width: w, height: h }).toPNG().toString('base64');
  });
  writeFileSync(p, Buffer.from(png, 'base64'));
  try {
    const { page, chip } = await chipDi(app, p, 'IMG_20260301_1012.png');
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Foto gatto sul divano', { timeout: 15000 });
    await expect(page.locator('.sn-rinomina-ext')).toHaveText('.png');
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Foto gatto sul divano.png');
    expect(readdirSync(dir)).toEqual(['Foto gatto sul divano.png']);
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});

test('PDF di 30 MB dal tasto destro in chat', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('filo-esp-grande-');
  const p = join(dir, 'scan_00999.pdf');
  writeFileSync(p, pdfConTesto(['Manuale lavatrice Bosch', 'Serie 6'], 30 * 1024 * 1024));
  try {
    const { page, chip } = await chipDi(app, p, 'scan_00999.pdf');
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await page.waitForTimeout(6000);
    const stato = await page.locator('.sn-rinomina-stato').innerText();
    const valore = await page.locator('.sn-rinomina-campo').inputValue();
    console.log('GRANDE stato=', JSON.stringify(stato), 'valore=', valore);
    await page.screenshot({ path: join(SHOTS, 'esp950-grande.png') });
    expect(valore).toBe('Manuale lavatrice Bosch Serie 6');
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});

test('tema scuro: riquadro in chat e negli scaricamenti', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-esp-scuro-');
  const p = join(dir, 'scan_00231.pdf');
  writeFileSync(p, pdfConTesto(['Bolletta luce Enel', 'Marzo 2026']));
  try {
    const { page, chip } = await chipDi(app, p, 'scan_00231.pdf');
    for (const tema of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: tema });
      await chip.click({ button: 'right' });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `esp950-menu-${tema}.png`) });
      await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
      await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
      await page.screenshot({ path: join(SHOTS, `esp950-riquadro-${tema}.png`) });
      await page.keyboard.press('Escape');
    }
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});

test('la chat dopo una rinomina dal tasto destro conosce il nome nuovo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-esp-dopo-');
  const p = join(dir, 'scan_00231.pdf');
  writeFileSync(p, pdfConTesto(['Bolletta luce Enel', 'Marzo 2026']));
  try {
    const { page, chip } = await chipDi(app, p, 'scan_00231.pdf');
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Bolletta luce Enel Marzo 2026.pdf');
    await page.mouse.click(5, 5);
    await chiedi(page, 'aprilo');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    const ultima = JSON.stringify((await chiamateAlModello(app)).at(-1));
    console.log('DOPO contiene nuovo=', ultima.includes('Bolletta luce Enel Marzo 2026.pdf'), 'contiene vecchio=', ultima.includes('scan_00231.pdf'));
    expect(ultima).toContain('Bolletta luce Enel Marzo 2026.pdf');
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});

test('in chat, nome dettato dall\'utente per un file', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-esp-dettato-');
  const p = join(dir, 'scan_00231.pdf');
  writeFileSync(p, pdfConTesto(['Bolletta luce Enel', 'Marzo 2026']));
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ percorsi: [p], nome: 'Luce marzo 🌞 <b>x</b>' }) }] },
      { text: 'Ecco.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'chiamalo Luce marzo');
    await expect.poll(() => confirmText(page), { timeout: 20000 }).toContain('scan_00231.pdf');
    console.log('DETTATO popup=', await confirmText(page));
    await clickConfirm(page, 'ok');
    await expect.poll(() => readdirSync(dir), { timeout: 15000 }).not.toEqual(['scan_00231.pdf']);
    console.log('DETTATO disco=', readdirSync(dir));
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});
