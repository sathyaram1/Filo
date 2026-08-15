// Verificatore #410.1 — invarianti UX che un utente incontra davvero:
// il file cancellato a mano, "Rimuovi dall'elenco" che non deve cancellare il
// file, e "Svuota" mentre qualcosa sta ancora scaricando.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, unlinkSync } from 'node:fs';

function serve(name, body, dripMs) {
  return new Promise((done) => {
    const srv = createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      if (!dripMs) { res.end(body); return; }
      let i = 0;
      const step = Math.ceil(body.length / 20);
      const tick = () => {
        if (i >= body.length) { res.end(); return; }
        res.write(body.subarray(i, i + step)); i += step;
        setTimeout(tick, dripMs);
      };
      tick();
    });
    srv.listen(0, '127.0.0.1', () => done({
      url: `http://127.0.0.1:${srv.address().port}/x`,
      close: async () => {
        try { srv.closeAllConnections?.(); } catch (_) {}
        await new Promise((r) => srv.close(r));
      },
    }));
  });
}

const items = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.downloads.list();
  return (r && r.items) || [];
});

const waitFor = (shell, name, state, timeout = 40000) =>
  expect.poll(async () => {
    const e = (await items(shell)).find((x) => x.filename === name);
    return e ? e.state : null;
  }, { timeout }).toBe(state);

test('se cancello il file a mano, "Apri file" non finge di riuscire', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const s = await serve('sparito.bin', Buffer.alloc(2048, 1));
  try {
    const page = await testServer.openReady(openTab,
      `<!doctype html><html><body><a id="dl" href="${s.url}">scarica</a></body></html>`);
    await page.locator('#dl').click();
    await waitFor(shell, 'sparito.bin', 'completed');
    const e = (await items(shell)).find((x) => x.filename === 'sparito.bin');
    expect(existsSync(e.savePath)).toBe(true);

    unlinkSync(e.savePath); // l'utente svuota il cestino / sposta il file

    const r = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), e.id);
    // #410.4 — l'esito dell'apertura non basta (su Linux shell.openPath dice
    // "riuscito" anche su un percorso inesistente): il main guarda il disco
    // PRIMA di tentare, quindi qui si pretende un rifiuto esplicito, con la
    // frase che l'utente vedrà.
    expect(r, 'nessuna risposta').toBeTruthy();
    expect(r.ok, 'ha finto di aprire un file che non c\'è più').toBe(false);
    expect(r.missing).toBe(true);
    expect(r.error).toMatch(/non c[’']è più/i);
    expect(await shell.evaluate(() => !!window.filoShell)).toBe(true);
  } finally { await s.close(); }
});

test('"Rimuovi dall\'elenco" toglie la voce ma NON cancella il file scaricato', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const s = await serve('resta-su-disco.bin', Buffer.alloc(4096, 2));
  try {
    const page = await testServer.openReady(openTab,
      `<!doctype html><html><body><a id="dl" href="${s.url}">scarica</a></body></html>`);
    await page.locator('#dl').click();
    await waitFor(shell, 'resta-su-disco.bin', 'completed');
    const e = (await items(shell)).find((x) => x.filename === 'resta-su-disco.bin');

    await shell.evaluate((id) => window.filoShell.downloads.remove(id), e.id);
    await expect.poll(async () =>
      (await items(shell)).some((x) => x.filename === 'resta-su-disco.bin'),
    { timeout: 10000 }).toBe(false);

    expect(existsSync(e.savePath), 'togliere la voce ha cancellato il file dell\'utente').toBe(true);
  } finally { await s.close(); }
});

test('"Svuota" mentre uno scaricamento è in corso non lascia zombie né rompe l\'app', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const s = await serve('in-corso.bin', Buffer.alloc(3 * 1024 * 1024, 3), 400);
  try {
    const page = await testServer.openReady(openTab,
      `<!doctype html><html><body><a id="dl" href="${s.url}">scarica</a></body></html>`);
    await page.locator('#dl').click();
    await waitFor(shell, 'in-corso.bin', 'progressing', 30000);

    const r = await shell.evaluate(() => window.filoShell.downloads.clear());
    expect(r.ok).toBe(true);

    // Come in Chrome, "Svuota" non ammazza ciò che sta ancora scaricando: la
    // voce può restare. L'invariante vera è che NON resti bloccata "in corso"
    // per sempre — o sparisce, o arriva a conclusione.
    await expect.poll(async () => {
      const e = (await items(shell)).find((x) => x.filename === 'in-corso.bin');
      return e ? e.state : 'assente';
    }, { timeout: 90000 }).not.toBe('progressing');
    expect(await shell.evaluate(() => !!window.filoShell)).toBe(true);
    // e un nuovo scaricamento funziona ancora dopo lo svuotamento
    await page.locator('#dl').click();
    await expect.poll(async () => (await items(shell)).length, { timeout: 30000 }).toBeGreaterThan(0);
  } finally { await s.close(); }
});
