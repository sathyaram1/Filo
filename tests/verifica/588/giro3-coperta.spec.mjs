// Verifica #588, giro 3: le due domande sui programmi devono VEDERSI mentre
// una pagina web è aperta. La pagina è una vista nativa che copre l'HTML della
// barra (patterns/animazioni-che-coprono-la-pagina-vivono-nel-content-overlay.md):
// un riquadro della barra che cade dentro l'area della pagina esiste nel DOM ma
// a schermo non c'è. Rosso finché la domanda sta lì sotto.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = String(req.url || '').split('?')[0].split('/').pop() || 'setup.exe';
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': EXE.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  return {
    base: `http://127.0.0.1:${porta}`,
    close: () => new Promise((r) => { try { srv.closeAllConnections?.(); } catch (_) {} srv.close(r); }),
  };
}

// Rettangolo della pagina attiva, se a schermo (vista nativa sopra la barra).
async function vistaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w && w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    if (!t || (t.view.getVisible && !t.view.getVisible())) return null;
    return t.view.getBounds();
  });
}

const siToccano = (a, b) => !!a && !!b
  && a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;

// Una domanda della barra si vede solo se nessun pezzo cade sotto la pagina.
async function riquadriVisibili(app, shell, testo) {
  const vista = await vistaAttiva(app);
  const carte = shell.locator('.shell-notif', { hasText: testo });
  const n = await carte.count();
  let visibili = 0;
  for (let i = 0; i < n; i++) {
    const box = await carte.nth(i).boundingBox();
    if (box && !siToccano(box, vista)) visibili++;
  }
  return { presenti: n, visibili };
}

const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return ((r && r.items) || []).find((it) => it.filename === nome)?.state ?? null;
};

test('la domanda «Scaricarlo?» si vede sopra la pagina web da cui parte', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <a id="exe" href="${srv.base}/setup.exe">Scarica il programma</a></body></html>`);
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');
    await expect.poll(() => riquadriVisibili(app, shell, 'Scaricarlo?'), {
      timeout: 10000,
      message: 'la domanda esiste ma la pagina la copre: a schermo non si vede',
    }).toMatchObject({ visibili: 1 });
  } finally {
    await srv.close();
  }
});

test('«Apri file» su un programma dal pannello: la seconda domanda si vede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <a id="exe" href="${srv.base}/setup.exe">Scarica il programma</a></body></html>`);
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    await shell.locator('#dl-indicator').click();
    const riga = shell.locator('.dl-row', { hasText: 'setup.exe' });
    await riga.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await riga.locator('.dl-row-btn', { hasText: 'Apri file' }).click();

    await expect.poll(() => riquadriVisibili(app, shell, 'eseguirlo'), {
      timeout: 10000,
      message: '«Apri file» su un programma: la domanda c’è ma sta sotto la pagina, il clic sembra non fare niente',
    }).toMatchObject({ visibili: 1 });
  } finally {
    await srv.close();
  }
});
