// #950 giro 3, rilievo 1: un file grande (oltre i 25 MB della lettura intera) prende comunque un nome: per il nome
// basta l'inizio. Senza cura il riquadro dice «Pesa 30.0 MB e il limite è 25 MB» e lascia il nome vecchio.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

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

test('un PDF di 30 MB trovato in chat: «Dai un nome sensato» propone il nome dal contenuto e rinomina', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('filo-esp-grande-');
  const p = join(dir, 'scan_00999.pdf');
  writeFileSync(p, pdfConTesto(['Manuale lavatrice Bosch', 'Serie 6'], 30 * 1024 * 1024));
  try {
    const { page, chip } = await chipDi(app, p, 'scan_00999.pdf');
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Manuale lavatrice Bosch Serie 6', { timeout: 20000 });
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Manuale lavatrice Bosch Serie 6.pdf');
    expect(readdirSync(dir)).toEqual(['Manuale lavatrice Bosch Serie 6.pdf']);
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});

