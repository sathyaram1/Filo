// DEBUG temporaneo della verifica: dump di cosa riceve lo stub del provider.
import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('debug provider stub', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const DIR = mkdtempSync(join(tmpdir(), 'filo-dbg-pdf-'));
  const PDF = join(DIR, 'estratto.pdf');
  writeFileSync(PDF, buildPdf('BT\n/F1 12 Tf\n72 720 Td\n(GIACENZA 4321,99 MARKER-VERIFICA-77812) Tj\nET'));

  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
  await app.evaluate(async ({ percorso }) => {
    globalThis.__vfCalls = [];
    globalThis.__vfErrors = [];
    const fake = async ({ attempts, messages, onDelta }) => {
      try {
        const flat = JSON.stringify(messages);
        globalThis.__vfCalls.push(flat.slice(-3000));
        let reply;
        if (globalThis.__vfCalls.length === 1) {
          reply = JSON.stringify({ text: 'Guardo il documento.', actions: [{ type: 'LEGGI_DOCUMENTO', percorso }] });
        } else {
          reply = JSON.stringify({ text: flat.includes('MARKER-VERIFICA-77812') ? 'CONTESTO-OK' : 'CONTESTO-VUOTO', actions: [] });
        }
        try { onDelta && onDelta(reply); } catch (_) {}
        return { text: reply, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      } catch (e) {
        globalThis.__vfErrors.push(String(e && e.stack || e));
        throw e;
      }
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = fake;
    globalThis.SN_PROVIDERS.completeWithFallback = fake;
  }, { percorso: PDF });

  await page.locator('#input').fill('quanto ho di giacenza?');
  await page.locator('#sendBtn').click();

  await page.waitForTimeout(25_000);
  const dump = await app.evaluate(() => ({
    n: globalThis.__vfCalls.length,
    tails: globalThis.__vfCalls.map((c) => c.slice(-600)),
    errors: globalThis.__vfErrors,
  }));
  console.log('CALLS:', dump.n);
  dump.tails.forEach((t, i) => console.log(`--- CALL ${i + 1} TAIL ---\n${t}\n`));
  console.log('ERRORS:', JSON.stringify(dump.errors, null, 2));
  const bubbles = await page.evaluate(() => [...document.querySelectorAll('.dash-bubble-filo')].map((b) => b.textContent.slice(0, 200)));
  console.log('BUBBLES:', JSON.stringify(bubbles, null, 2));
});
