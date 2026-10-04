// Verifica #950 giro 4, rilievo 1: i nomi di serie delle app per scansionare col telefono non dicono cosa c'è
// nel file, e «rinomina i file in quella cartella» deve proporli come «scan_00231.pdf».
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { confirmText } from '../../helpers/confirm.mjs';


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

async function modelloDeiNomi(app, { ritardoMs = 0 } = {}) {
  await app.evaluate(async (_e, ritardoMs) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      if (ritardoMs) await new Promise((r) => setTimeout(r, ritardoMs));
      const u = messages.find((m) => m.role === 'user');
      const testo = typeof u.content === 'string' ? u.content : u.content.map((p) => p.text || '').join('\n');
      const m = /Nome attuale:[^\n]*\n\n([^\n]+)\n([^\n]+)/.exec(testo);
      return { text: m ? `${m[1]} ${m[2]}` : 'NESSUN NOME', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, ritardoMs);
}

test('in chat «rinomina i file» di una cartella propone anche i PDF di CamScanner e Adobe Scan', async ({ app }) => {
  test.setTimeout(120_000);
  const dir = cartellaInCasa('filo-g4-scanner-');
  writeFileSync(join(dir, 'scan_00231.pdf'), BOLLETTA);
  writeFileSync(join(dir, 'CamScanner 03-01-2026 10.12.pdf'), pdfConTesto(['Contratto affitto', 'Via Roma 12']));
  writeFileSync(join(dir, 'Adobe Scan 1 mar 2026.pdf'), pdfConTesto(['Ricevuta farmacia', 'Lunedi 2 marzo']));
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'r1', name: 'RINOMINA_FILE', arguments: JSON.stringify({ cartella: dir }) }] },
      { text: 'Ecco.' },
    ]);
    await modelloDeiNomi(app);
    const page = await home(app);
    await chiedi(page, 'rinomina i file in quella cartella con nomi che abbiano senso');
    await expect.poll(() => confirmText(page), { timeout: 20000 }).toContain('scan_00231.pdf');
    const t = await confirmText(page);
    expect(t).toContain('CamScanner');
    expect(t).toContain('Adobe Scan');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
