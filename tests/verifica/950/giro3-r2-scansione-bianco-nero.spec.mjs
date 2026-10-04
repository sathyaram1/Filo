// #950 giro 3, rilievo 2: una scansione in bianco e nero (immagine a 1 bit, il modo «testo» degli scanner da
// ufficio) arriva al modello come immagine e prende un nome. Senza cura il riquadro dice che dentro non c'è niente.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

// Una pagina A4 a 1 bit (DeviceGray, BitsPerComponent 1, senza compressione): righe nere su bianco.
function scansioneBiancoNero() {
  const w = 600, h = 800, riga = Math.ceil(w / 8);
  const bit = Buffer.alloc(riga * h, 0xff);
  for (let y = 100; y < 700; y += 40) for (let k = 0; k < 8; k++) bit.fill(0x00, (y + k) * riga + 8, (y + k) * riga + riga - 8);
  const contenuto = `q 595 0 0 842 0 0 cm /Im1 Do Q`;
  const oggetti = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.from(`<< /Length ${contenuto.length} >>\nstream\n${contenuto}\nendstream`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 1 /Length ${bit.length} >>\nstream\n`), bit, Buffer.from('\nendstream')]),
  ];
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  const pos = [];
  oggetti.forEach((o, i) => { pos.push(out.length); out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); });
  const xref = out.length;
  return Buffer.concat([out, Buffer.from(`xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`
    + pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
}

async function modelloDeiNomi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const img = Array.isArray(u.content) && u.content.some((p) => p.type === 'image_url');
      return { text: img ? 'Bolletta luce marzo 2026' : 'NESSUN NOME', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

test('una scansione in bianco e nero trovata in chat: «Dai un nome sensato» la manda come immagine e rinomina', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-ver950-bn-');
  const p = join(dir, 'scan_00231.pdf');
  writeFileSync(p, scansioneBiancoNero());
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: p, etichetta: 'scan_00231.pdf' }) }] },
      { text: 'Eccolo.' },
      { text: 'Fatto.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'trova il file');
    const chip = page.locator('a.dash-action-btn', { hasText: 'scan_00231.pdf' });
    await expect(chip).toBeVisible({ timeout: 15000 });
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-campo')).toHaveValue('Bolletta luce marzo 2026', { timeout: 20000 });
    await page.locator('.sn-rinomina-ok').click();
    await expect(page.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Bolletta luce marzo 2026.pdf');
    expect(readdirSync(dir)).toEqual(['Bolletta luce marzo 2026.pdf']);
  } finally { await ripristina(app); rmSync(dir, { recursive: true, force: true }); }
});
