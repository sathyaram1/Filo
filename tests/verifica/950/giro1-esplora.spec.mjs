// Verifica #950, giro 1 — esplorazione: tema scuro, Annulla dopo la chiusura, conferma durante il caricamento,
// nomi strani dal modello, doppioni in chat.

import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { confirmText, clickConfirm } from '../../helpers/confirm.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
mkdirSync(SHOTS, { recursive: true });

function pdfConTesto(righe) {
  const corpo = righe.map((r, i) => `${i ? '0 -24 Td\n' : ''}(${r.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n');
  const stream = `BT\n/F1 14 Tf\n40 700 Td\n${corpo}\nET\n`;
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const posizioni = [];
  oggetti.forEach((o, i) => { posizioni.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`
    + posizioni.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const BOLLETTA = pdfConTesto(['Bolletta luce Enel', 'Marzo 2026', 'Totale da pagare 54,20 euro']);

async function modelloDeiNomi(app, { ritardoMs = 0, risposta = null } = {}) {
  await app.evaluate(async (_e, o) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      if (o.ritardoMs) await new Promise((r) => setTimeout(r, o.ritardoMs));
      const u = messages.find((m) => m.role === 'user');
      const testo = typeof u.content === 'string' ? u.content : u.content.map((p) => p.text || '').join('\n');
      const m = /Nome attuale:[^\n]*\n\n([^\n]+)\n([^\n]+)/.exec(testo);
      const t = o.risposta != null ? o.risposta : (m ? `«${m[1]} ${m[2]}.pdf»` : 'NESSUN NOME');
      return { text: t, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, { ritardoMs, risposta });
}

async function chipInChat(app, percorso) {
  await modelloFinto(app, [
    { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso, etichetta: 'scan_00231.pdf' }) }] },
    { text: 'Eccolo.' },
  ]);
}

test('tema scuro: menu, riquadro con la proposta e riquadro a rinomina fatta', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
    await chipInChat(app, vecchio);
    await modelloDeiNomi(app);
    const page = await home(app);
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();
    await chiedi(page, 'trova la bolletta');
    const chip = page.locator('a.dash-action-btn', { hasText: 'scan_00231.pdf' });
    await expect(chip).toBeVisible({ timeout: 15000 });
    await chip.click({ button: 'right' });
    await expect(page.locator('.sn-rinomina-menu')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'v950-scuro-menu.png') });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await page.screenshot({ path: join(SHOTS, 'v950-scuro-proposta.png') });
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-esito-testo')).toContainText('Rinominato');
    await page.screenshot({ path: join(SHOTS, 'v950-scuro-fatto.png') });
    const pref = await page.context().newPage?.().catch(() => null);
    void pref;
  } finally {
    await ripristina(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'auto' }));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preferenze in tema scuro: la sezione dei nomi dei file', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  try {
    const pref = await openTab('filo://preferences/preferences.html');
    await expect(pref.locator('#sec-nomi-file')).toBeVisible();
    await pref.locator('#sec-nomi-file').scrollIntoViewIfNeeded();
    await pref.screenshot({ path: join(SHOTS, 'v950-scuro-preferenze.png') });
  } finally {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'auto' }));
  }
});

test('chat: rinominato e poi cliccato altrove, il nome di prima si rimette ancora dal tasto destro', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await chipInChat(app, vecchio);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'trova la bolletta');
    const chip = page.locator('a.dash-action-btn').first();
    await expect(chip).toHaveText('scan_00231.pdf', { timeout: 15000 });
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce Enel Marzo 2026', { timeout: 15000 });
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-esito-testo')).toContainText('Rinominato');
    // Un clic qualunque altrove: il riquadro con «Annulla» se ne va.
    await page.mouse.click(5, 5);
    await expect(page.locator('.sn-rinomina')).toHaveCount(0);
    await chip.click({ button: 'right' });
    const voci = await page.locator('.sn-rinomina-menu .sn-select-option').allTextContents();
    console.log('voci dopo la rinomina:', voci);
    await page.screenshot({ path: join(SHOTS, 'v950-menu-dopo.png') });
    expect(voci.join(' | ')).toMatch(/Rimetti|Annulla|nome di prima/i);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Rinomina premuto mentre Filo legge ancora il file', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, BOLLETTA);
  try {
    await chipInChat(app, vecchio);
    await modelloDeiNomi(app, { ritardoMs: 3000 });
    const page = await home(app);
    await chiedi(page, 'trova la bolletta');
    const chip = page.locator('a.dash-action-btn').first();
    await expect(chip).toHaveText('scan_00231.pdf', { timeout: 15000 });
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-stato')).toContainText('Leggo');
    await page.screenshot({ path: join(SHOTS, 'v950-caricamento.png') });
    await page.locator('.sn-rinomina-campo').press('Enter');
    await page.waitForTimeout(4000);
    const stato = await page.locator('.sn-rinomina').innerText().catch(() => '(chiuso)');
    console.log('dopo Enter durante il caricamento:', JSON.stringify(stato), readdirSync(dir));
    await page.screenshot({ path: join(SHOTS, 'v950-enter-presto.png') });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nomi strani dal modello: markup, emoji, lunghissimo, estensione diversa', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('filo-v950-');
  const casi = [
    '<img src=x onerror="document.title=\'XSS\'">Fattura',
    '🧾 Ricevuta pizzeria 🍕',
    'Relazione '.repeat(40),
    'Bolletta.exe',
    '   ',
    'Nome: ../../etc/passwd',
  ];
  try {
    for (const [i, risposta] of casi.entries()) {
      const vecchio = join(dir, `scan_${i}.pdf`);
      writeFileSync(vecchio, BOLLETTA);
      await chipInChat(app, vecchio);
      await modelloDeiNomi(app, { risposta });
      const page = await home(app);
      await chiedi(page, `trova ${i}`);
      const chip = page.locator('a.dash-action-btn', { hasText: `scan_${i}.pdf` });
      await expect(chip).toBeVisible({ timeout: 15000 });
      await chip.click({ button: 'right' });
      await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
      await page.waitForTimeout(800);
      const v = await page.locator('.sn-rinomina-campo').inputValue();
      const st = await page.locator('.sn-rinomina-stato').innerText().catch(() => '');
      console.log(`caso ${i}:`, JSON.stringify(v), JSON.stringify(st));
      await page.locator('.sn-rinomina-ok').click();
      await page.waitForTimeout(500);
      console.log('  esito:', await page.locator('.sn-rinomina').innerText().catch(() => ''), await page.title());
      await page.screenshot({ path: join(SHOTS, `v950-strano-${i}.png`) });
      await page.keyboard.press('Escape');
    }
    console.log('cartella:', readdirSync(dir));
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chat: due scansioni dello stesso documento', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = cartellaInCasa('filo-v950-dop-');
  writeFileSync(join(dir, 'scan_00231.pdf'), BOLLETTA);
  writeFileSync(join(dir, 'scan_00231 (1).pdf'), BOLLETTA);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ cartella: dir }) }] },
      { text: 'Ecco.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'rinomina i file in quella cartella');
    await expect.poll(() => confirmText(page), { timeout: 20000 }).toContain('→');
    console.log('popup:', await confirmText(page));
    await page.screenshot({ path: join(SHOTS, 'v950-doppioni-popup.png') });
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-action-btn', { hasText: /Rinominat/ })).toBeVisible({ timeout: 15000 });
    console.log('dopo:', readdirSync(dir));
    await page.locator('.dash-action-btn', { hasText: 'Annulla' }).click();
    await expect(page.locator('.dash-action-btn', { hasText: 'Nomi di prima rimessi' })).toBeVisible({ timeout: 10000 });
    console.log('annullato:', readdirSync(dir));
    expect(readdirSync(dir).sort()).toEqual(['scan_00231 (1).pdf', 'scan_00231.pdf']);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
