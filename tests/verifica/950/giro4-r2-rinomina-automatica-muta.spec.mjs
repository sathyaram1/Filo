// Verifica #950 giro 4, rilievo 2: col nome automatico degli scaricamenti acceso, una rinomina che il sistema
// rifiuta (file aperto in un altro programma) non può finire nel silenzio: l'utente deve sapere che il nome non c'è.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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

test('rinomina automatica rifiutata dal sistema: un avviso dice che quel file è rimasto col suo nome', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  await modelloDeiNomi(app, { ritardoMs: 4000 });
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ nomiSensati: { scaricamenti: true } }));
  const corpo = BOLLETTA;
  const nome = 'scan_00777.pdf';
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': corpo.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/${nome}`;
  let dirDl = '';
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
    await page.locator('#dl').click();
    let rec = null;
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      rec = ((r && r.items) || []).find((it) => it.url === url) || null;
      return rec ? rec.state : null;
    }, { timeout: 20000 }).toBe('completed');
    dirDl = join(rec.savePath, '..');
    // Il file aperto in un altro programma (Windows): il sistema rifiuta la rinomina con EBUSY.
    await app.evaluate(() => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      globalThis.__origLink = fsp.link; globalThis.__origRename = fsp.rename;
      const occ = async () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
      fsp.link = occ; fsp.rename = occ;
    });
    await page.waitForTimeout(7000);
    expect(readdirSync(dirDl)).toContain(nome);
    const vista = await avvisi();
    await expect.poll(async () => (await vista.locator('body').innerText()).replace(/Scaricato: [^\n]*/g, ''), { timeout: 10000 })
      .toMatch(/nome/i);
  } finally {
    await app.evaluate(() => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      if (globalThis.__origLink) { fsp.link = globalThis.__origLink; fsp.rename = globalThis.__origRename; }
    });
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
