// #1561.6 — «Nome di prima rimesso» e «Il nome di prima era occupato», scritti dalla cornice dopo «Annulla» sul nome
// automatico, portano il sito dello scaricamento: cancellate le pagine di quel sito, dal filo non resta il nome del file.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

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
  const posizioni = [];
  oggetti.forEach((o, i) => { posizioni.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`
    + posizioni.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const REFERTO = pdfConTesto(['Referto clinica Santa Rita', 'Aprile 2026']);
const NOME_NUOVO = 'Referto clinica Santa Rita Aprile 2026.pdf';

async function nomeAutomatico(app, openTab) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const testo = typeof u.content === 'string' ? u.content : u.content.map((p) => p.text || '').join('\n');
      const m = /Nome attuale:[^\n]*\n\n([^\n]+)\n([^\n]+)/.exec(testo);
      return { text: m ? `«${m[1]} ${m[2]}.pdf»` : 'NESSUN NOME', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#nomiSensatiScaricamenti').check();
  await expect.poll(() => app.evaluate(async () => !!(await globalThis.SN_STORAGE.getSettings()).nomiSensati?.scaricamenti)).toBe(true);
}

const avvisiCol = async (app, parola) => (await app.evaluate(async () => {
  await globalThis.SN_IL_FILO.quandoFermo();
  return globalThis.SN_IL_FILO.accaduti({ tipi: ['notifica'] });
})).filter((e) => String(e.testo || '').includes(parola));

for (const occupato of [false, true]) {
  test(`«Annulla» sul nome automatico${occupato ? ' col nome di prima occupato' : ''}: cancellate le pagine del sito, nel filo non resta nessun avviso col nome del file`, async ({ app, shell, openTab, testServer, avvisi }) => {
    test.setTimeout(120_000);
    await nomeAutomatico(app, openTab);
    const nome = `scan_0${occupato ? 2 : 1}${String(Date.now()).slice(-4)}.pdf`;
    const srv = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': REFERTO.length, 'Content-Disposition': `attachment; filename="${nome}"` });
      res.end(REFERTO);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      // Un nome da internet: da 127.0.0.1, rete di casa, il nome automatico non parte (#1274.1).
      const url = `http://sito-pubblico.test:${srv.address().port}/${nome}`;
      const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body>`, { pubblico: true });
      await page.locator('#dl').click();
      let rec = null;
      await expect.poll(async () => {
        rec = (((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || []).find((it) => it.url === url) || null;
        return rec && rec.state;
      }, { timeout: 20000 }).toBe('completed');
      const dir = dirname(rec.savePath);
      const vecchio = join(dir, nome);
      await expect.poll(() => existsSync(join(dir, NOME_NUOVO)) && !existsSync(vecchio), { timeout: 20000 }).toBe(true);
      if (occupato) writeFileSync(vecchio, 'un altro file col nome di prima');
      const vista = await avvisi();
      await vista.locator('.shell-notif-action', { hasText: 'Annulla' }).last().click();
      const radice = nome.replace(/\.pdf$/, '');
      const atteso = occupato ? 'Il nome di prima era occupato' : 'Nome di prima rimesso';
      await expect.poll(async () => (await avvisiCol(app, atteso)).filter((e) => String(e.testo).includes(radice)).length, { timeout: 15000 }).toBe(1);

      await app.evaluate(() => globalThis.SN_IL_FILO.cancellaPagine({ da: null, a: null, sito: 'sito-pubblico.test' }));
      await expect.poll(async () => (await avvisiCol(app, radice)).map((e) => e.testo), { timeout: 10000 }).toEqual([]);
    } finally {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    }
  });
}
