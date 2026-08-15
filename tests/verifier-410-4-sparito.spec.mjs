// Verificatore #410.4 — il file scaricato non c'è più. Qui NON si ricontrolla
// il caso felice già coperto altrove: si prova a ROMPERE l'invariante con i
// casi limite che un utente incontra davvero.
//
//   A) controllo positivo: finché il file è al suo posto niente deve cambiare
//      (una marcatura che scatta sempre "funzionerebbe" anche rotta);
//   B) il file torna al suo posto → la voce deve tornare normale (lo stato non
//      può essere una condanna definitiva);
//   C) cartella sparita insieme al file → messaggio diverso, non lo stesso;
//   D) doppio clic rapido e id inesistente → nessun crash, risposta sensata;
//   E) nome di file ostile (HTML/emoji/lunghissimo) → mostrato come testo,
//      niente script eseguito, niente riga che sfonda il layout;
//   F) uno scaricamento ANNULLATO non deve essere marcato "sparito": il suo
//      file non è mai esistito, dirlo sarebbe falso;
//   G) parità: il pannello in alto e la pagina elenco devono dire la stessa
//      cosa della stessa voce.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CORPO = Buffer.from('%PDF-1.4\n% finto pdf del verificatore\n' + 'z'.repeat(4096));

// Scarica un file col nome dato e aspetta che sia davvero sul disco.
async function scarica(nome, { shell, openTab, testServer }, corpo = CORPO) {
  const srv = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': corpo.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/scarica`;
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
  await page.locator('#dl').click();

  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    const e = ((r && r.items) || []).find((it) => it.filename === nome);
    return e ? e.state : null;
  }, { timeout: 20000 }).toBe('completed');

  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  const rec = ((r && r.items) || []).find((it) => it.filename === nome);
  expect(existsSync(rec.savePath)).toBe(true);
  return {
    rec,
    close: async () => {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r2) => srv.close(r2));
    },
  };
}

const leggi = async (shell, id) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return ((r && r.items) || []).find((it) => it.id === id);
};

test('A+B — finché il file c\'è la voce è normale; se torna al suo posto torna normale', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { rec, close } = await scarica('andata-e-ritorno.bin', { shell, openTab, testServer });
  try {
    // A) Controllo positivo: il file è lì, la voce NON deve dirsi sparita e
    //    "Apri file" deve rispondere bene. Senza questo, una marcatura sempre
    //    accesa passerebbe per funzionante.
    expect((await leggi(shell, rec.id)).missing).toBe(false);
    const okRes = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(okRes.ok).not.toBe(false);

    // Il file sparisce: da qui la voce deve dirlo.
    const salvato = Buffer.from(CORPO);
    const percorso = rec.savePath;
    unlinkSync(percorso);
    const spar = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(spar.ok).toBe(false);
    expect(spar.missing).toBe(true);
    expect(String(spar.error)).toMatch(/non c.è più/i);
    expect(await expect.poll(async () => (await leggi(shell, rec.id)).missing, { timeout: 6000 }).toBe(true)
      .then(() => true).catch(() => false)).toBeTruthy();

    // B) L'utente lo rimette dov'era (o annulla la cancellazione dal cestino):
    //    la voce deve tornare apribile. Se lo stato restasse appiccicato, il
    //    file ci sarebbe ma Filo continuerebbe a dire di no.
    writeFileSync(percorso, salvato);
    await expect.poll(async () => (await leggi(shell, rec.id)).missing, { timeout: 8000 }).toBe(false);
    const ri = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(ri.ok).not.toBe(false);
  } finally { await close(); }
});

test('C — se sparisce anche la cartella, il messaggio è diverso da "manca il file"', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { rec, close } = await scarica('cartella-sparita.bin', { shell, openTab, testServer });
  try {
    // Caso 1: file sparito, cartella ancora lì → la cartella si apre lo stesso
    // e l'esito dice "il file dentro non c'è".
    unlinkSync(rec.savePath);
    const conCartella = await shell.evaluate((id) => window.filoShell.downloads.openFolder(id), rec.id);
    expect(conCartella.missing).toBe(true);
    expect(conCartella.missingFolder).toBeFalsy();

    // Caso 2: sparita anche la cartella. Deve cambiare il messaggio: dire
    // "manca il file" quando manca tutta la cartella manda l'utente a cercare
    // nel posto sbagliato.
    const cartella = dirname(rec.savePath);
    const parcheggio = `${cartella}-via`;
    renameSync(cartella, parcheggio);
    try {
      const senzaCartella = await shell.evaluate((id) => window.filoShell.downloads.openFolder(id), rec.id);
      expect(senzaCartella.ok).toBe(false);
      expect(senzaCartella.missingFolder).toBe(true);
      expect(String(senzaCartella.error)).toMatch(/cartella/i);
      expect(String(senzaCartella.error)).not.toBe(String(conCartella.error || ''));
    } finally {
      renameSync(parcheggio, cartella);
    }
  } finally { await close(); }
});

test('D — doppio comando rapido e id inesistente: risposta sensata, niente crash', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { rec, close } = await scarica('doppio-clic.bin', { shell, openTab, testServer });
  try {
    unlinkSync(rec.savePath);
    // Doppio clic rapidissimo: entrambe le risposte devono dire la stessa cosa,
    // non una sì e una no (sarebbe la cache a decidere invece del disco).
    const [a, b] = await shell.evaluate(async (id) => Promise.all([
      window.filoShell.downloads.openFile(id),
      window.filoShell.downloads.openFile(id),
    ]), rec.id);
    expect(a.missing).toBe(true);
    expect(b.missing).toBe(true);

    // Voce non più in elenco: niente eccezione, e una frase comprensibile.
    const fantasma = await shell.evaluate(() => window.filoShell.downloads.openFile('id-che-non-esiste'));
    expect(fantasma.ok).toBe(false);
    expect(String(fantasma.error || '')).not.toBe('');
    const fantasmaDir = await shell.evaluate(() => window.filoShell.downloads.openFolder('id-che-non-esiste'));
    expect(fantasmaDir.ok).toBe(false);

    // La shell è ancora viva dopo tutto questo.
    expect(await shell.evaluate(() => !!window.filoShell)).toBe(true);
  } finally { await close(); }
});

test('E — nome di file ostile: mostrato come testo, nessuno script eseguito', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const nome = '<img src=x onerror=window.__filoXss=1>ciao😀' + 'a'.repeat(160) + '.bin';
  const { rec, close } = await scarica(nome, { shell, openTab, testServer });
  try {
    unlinkSync(rec.savePath);
    await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);

    const pagina = await openTab('filo://downloads/downloads.html');
    await pagina.waitForSelector('.dl-item', { timeout: 15000 });
    await expect.poll(async () => pagina.locator('.dl-item[data-missing="1"]').count(),
      { timeout: 10000 }).toBeGreaterThan(0);

    const riga = pagina.locator(`.dl-item[data-id="${rec.id}"]`);
    await expect(riga).toHaveAttribute('data-missing', '1');
    // Il nome ostile è finito nel DOM come TESTO: niente <img> iniettata,
    // niente flag impostata dall'handler onerror.
    expect(await pagina.evaluate(() => !!window.__filoXss)).toBeFalsy();
    expect(await riga.locator('.dl-name img').count()).toBe(0);
    expect(await riga.locator('.dl-name').innerText()).toContain('onerror');

    // Il nome lunghissimo non deve sfondare la pagina in orizzontale.
    const sfonda = await pagina.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(sfonda).toBe(false);

    // Niente "Apri file" su una voce svuotata, né fra i bottoni né al clic.
    const etichette = await riga.locator('.dl-btn').allInnerTexts();
    expect(etichette.join('|')).not.toContain('Apri file');

    await pagina.screenshot({ path: 'tests/.shots/verifier-410-4-nome-ostile.png' }).catch(() => {});
  } finally { await close(); }
});

test('F — uno scaricamento annullato non viene marcato "sparito"', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  // Server che sgocciola: c'è tempo per annullare a metà.
  const corpo = Buffer.alloc(6 * 1024 * 1024, 0x41);
  const srv = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(corpo.length),
      'Content-Disposition': 'attachment; filename="annullato.bin"',
    });
    let i = 0;
    const passo = 64 * 1024;
    const tick = () => {
      if (i >= corpo.length) { res.end(); return; }
      res.write(corpo.subarray(i, i + passo));
      i += passo;
      setTimeout(tick, 60);
    };
    tick();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/lento`;
    const page = await testServer.openReady(openTab,
      `<!doctype html><html><body><a id="dl" href="${url}">Scarica</a></body></html>`);
    await page.locator('#dl').click();

    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return ((r && r.items) || []).some((it) => it.filename === 'annullato.bin');
    }, { timeout: 20000 }).toBe(true);

    const r0 = await shell.evaluate(() => window.filoShell.downloads.list());
    const id = ((r0 && r0.items) || []).find((it) => it.filename === 'annullato.bin').id;
    await shell.evaluate((x) => window.filoShell.downloads.cancel(x), id);

    await expect.poll(async () => (await leggi(shell, id))?.state, { timeout: 15000 })
      .toMatch(/cancelled|interrupted/);
    // Il file non è mai esistito: chiamarlo "sparito" sarebbe una bugia.
    expect((await leggi(shell, id)).missing).toBe(false);

    const pagina = await openTab('filo://downloads/downloads.html');
    await pagina.waitForSelector('.dl-item', { timeout: 15000 });
    const riga = pagina.locator(`.dl-item[data-id="${id}"]`);
    expect(await riga.getAttribute('data-missing')).toBeNull();
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r2) => srv.close(r2));
  }
});

test('G — pannello in alto e pagina elenco dicono la stessa cosa della stessa voce', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const { rec, close } = await scarica('parita.bin', { shell, openTab, testServer });
  try {
    unlinkSync(rec.savePath);
    await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);

    // Pannello degli scaricamenti nella barra in alto.
    await shell.locator('#dl-indicator').click();
    await shell.waitForSelector('#dl-panel-list .dl-row', { timeout: 10000 });
    const rigaPannello = shell.locator(`#dl-panel-list .dl-row[data-missing="1"]`).first();
    await expect(rigaPannello).toHaveCount(1);
    const bottoniPannello = await rigaPannello.locator('.dl-row-btn').allInnerTexts();
    expect(bottoniPannello.join('|')).not.toContain('Apri file');
    await shell.screenshot({ path: 'tests/.shots/verifier-410-4-pannello.png' }).catch(() => {});

    // Stessa voce nella pagina elenco.
    const pagina = await openTab('filo://downloads/downloads.html');
    await pagina.waitForSelector('.dl-item', { timeout: 15000 });
    const riga = pagina.locator(`.dl-item[data-id="${rec.id}"]`);
    await expect(riga).toHaveAttribute('data-missing', '1');
    // Attenuata e barrata: si legge prima del clic.
    const stile = await riga.evaluate((el) => {
      const s = getComputedStyle(el);
      const n = getComputedStyle(el.querySelector('.dl-name'));
      return { opacity: Number(s.opacity), deco: n.textDecorationLine };
    });
    expect(stile.opacity).toBeLessThan(1);
    expect(stile.deco).toContain('line-through');
  } finally { await close(); }
});
