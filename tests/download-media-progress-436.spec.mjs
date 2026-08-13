// #436 — "Salva video come…" su un file VERO: due cose che con le clip di prova
// non si vedono.
//
//  1) Nessun avanzamento. Salvando un filmato di decine di MB non succedeva
//     niente a schermo finché non era finito: nessuna percentuale, nessuna
//     barra, nessun modo di sapere se stava scaricando o si era impantanato.
//  2) Un tetto oltre il quale rinunciava (mezzo giga per i media, 64MB per le
//     immagini), perché il file veniva tenuto TUTTO IN MEMORIA prima di essere
//     scritto su disco.
//
// Entrambe hanno la stessa causa e la stessa cura: scrivere il file su disco
// mentre arriva invece che alla fine. Da lì il tetto sparisce e i byte ricevuti
// diventano un dato di avanzamento mostrabile — e l'unico posto sensato dove
// mostrarlo è la barra degli scaricamenti che Filo ha già (#410.1), la stessa
// che segue i download partiti da un link.
//
// Gli assert sono di SUCCESSO:
//  - il file cresce su disco MENTRE il trasferimento è ancora in corso (prima
//    non esisteva niente fino all'ultimo byte);
//  - la barra mostra una percentuale intermedia del filmato in arrivo;
//  - un file più grande del vecchio tetto arriva integro;
//  - "Annulla" ferma davvero il trasferimento.
// Senza il fix: nessuna voce nella barra, nessun file parziale, e il file oltre
// il tetto non arriva mai → rosso.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Serve `total` byte a blocchi, con una pausa fra l'uno e l'altro: così il
// trasferimento dura abbastanza da poter essere osservato mentre accade (è
// esattamente la condizione del feedback — il file vero, non la clip di prova).
async function slowServer({ chunk, chunks, gapMs, contentType }) {
  const block = Buffer.alloc(chunk, 0x5a);
  const total = chunk * chunks;
  let served = 0;
  const srv = createServer((req, res) => {
    served++;
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': total });
    let i = 0;
    const tick = () => {
      if (res.writableEnded || res.destroyed) return;
      if (i >= chunks) { res.end(); return; }
      i++;
      res.write(block);
      setTimeout(tick, gapMs);
    };
    tick();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    total,
    byte: 0x5a,
    url: (name) => `http://127.0.0.1:${srv.address().port}/${name}`,
    get served() { return served; },
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

// `preload="none"`: il <video> non deve scaricarsi il filmato da solo, altrimenti
// il server servirebbe due trasferimenti insieme e l'osservazione diventa torbida.
function pageWithVideo(src) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Articolo con filmato</h1>
    <video id="v" src="${src}" preload="none" width="320" height="180" style="background:#333"></video>
  </body></html>`;
}

async function saveVideo(page) {
  await page.locator('#v').click({ button: 'right', position: { x: 20, y: 20 } });
  const item = page.locator('.sn-menu button', { hasText: 'Salva video come' });
  await expect(item).toBeVisible();
  await item.click();
}

const partsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.filo-part')) : []);

test('salvando un filmato il file cresce su disco e la barra mostra l\'avanzamento', async ({ app, shell, openTab, testServer }) => {
  // ~6MB in 24 blocchi da 80ms: qualche secondo di trasferimento osservabile.
  const media = await slowServer({ chunk: 256 * 1024, chunks: 24, gapMs: 80, contentType: 'video/mp4' });
  try {
    const page = await testServer.openReady(openTab, pageWithVideo(media.url('filmato.mp4')));
    const pageUrl = page.url();
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(dir).toBeTruthy();

    await saveVideo(page);

    // 1) IL FILE ARRIVA SU DISCO MENTRE SCARICA — è il cuore del fix. Prima
    //    tutto restava in memoria fino all'ultimo byte, quindi in questo istante
    //    non c'era NIENTE da vedere né in RAM né su disco.
    await expect.poll(() => partsIn(dir).length, { timeout: 15000 }).toBeGreaterThan(0);
    const part = join(dir, partsIn(dir)[0]);
    const firstSize = statSync(part).size;
    expect(firstSize).toBeLessThan(media.total); // ancora a metà strada
    await expect
      .poll(() => (existsSync(part) ? statSync(part).size : media.total), { timeout: 15000 })
      .toBeGreaterThan(firstSize); // …e continua a crescere

    // 2) L'AVANZAMENTO È MOSTRATO. Il filmato compare fra gli scaricamenti con
    //    il peso dichiarato dal server e i byte già ricevuti: è il dato che la
    //    barra trasforma in percentuale.
    const live = await (async () => {
      let seen = null;
      await expect.poll(async () => {
        const r = await shell.evaluate(() => window.filoShell.downloads.list());
        const e = ((r && r.items) || []).find((it) => it.filename === 'filmato.mp4');
        if (e && e.state === 'progressing' && e.receivedBytes > 0) seen = e;
        return seen ? 'ok' : (e ? e.state : 'assente');
      }, { timeout: 15000 }).toBe('ok');
      return seen;
    })();
    expect(live.totalBytes).toBe(media.total);
    const percent = Math.round((live.receivedBytes / live.totalBytes) * 100);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan(100);

    // 3) …e la barra in alto lo sta davvero dicendo all'utente: l'indicatore
    //    degli scaricamenti è visibile con la sua parte riempita.
    const bar = await shell.evaluate(() => {
      const btn = document.getElementById('dl-btn');
      const fill = document.getElementById('dl-ind-fill');
      return { hidden: !!(btn && btn.hidden), active: !!(btn && btn.classList.contains('active')), width: fill ? fill.style.width : '' };
    });
    expect(bar.hidden).toBe(false);
    expect(bar.active).toBe(true);
    expect(bar.width).not.toBe('');

    // 4) A fine corsa: il file completo, integro, e nessun file di lavoro
    //    lasciato in giro.
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 30000 })
      .toContain('filmato.mp4');
    const saved = join(dir, 'filmato.mp4');
    await expect.poll(() => statSync(saved).size, { timeout: 30000 }).toBe(media.total);
    await expect.poll(() => partsIn(dir).length, { timeout: 15000 }).toBe(0);

    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.filename === 'filmato.mp4');
      return e ? e.state : null;
    }, { timeout: 20000 }).toBe('completed');

    // La scheda non è navigata sul filmato e l'utente ha la sua conferma.
    expect(page.url()).toBe(pageUrl);
    await expect(page.locator('.sn-toast')).toContainText('Video salvato');
  } finally {
    await media.close();
  }
});

test('un file più grande del vecchio tetto in memoria arriva comunque, integro', async ({ app, openTab, testServer }) => {
  // 72MB: sopra il tetto anti-OOM che il salvataggio aveva (64MB per le
  // immagini, mezzo giga per i media — stessa funzione, stesso limite di
  // progetto). Prima il salvataggio si fermava con "file troppo grande" perché
  // il file passava tutto dalla memoria; ora scende su disco a blocchi e la
  // dimensione non è più un problema. Servito a piena velocità: qui interessa la
  // mole, non il tempo.
  const big = await slowServer({ chunk: 1024 * 1024, chunks: 72, gapMs: 0, contentType: 'image/png' });
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Un'immagine enorme</h1>
      <img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="64" height="64">
    </body></html>`);
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

    // Il salvataggio è quello del menu, invocato sull'URL grande: passa per lo
    // stesso handler del tasto destro su un'immagine/video.
    const res = await page.evaluate(async (url) => {
      const MSG = globalThis.SN_MSG ? globalThis.SN_MSG.MSG : null;
      return chrome.runtime.sendMessage({ type: (MSG && MSG.DOWNLOAD_MEDIA) || 'download_media', url, kind: 'video' });
    }, big.url('enorme.mp4'));

    expect(res.ok).toBe(true);
    const saved = join(dir, 'enorme.mp4');
    expect(existsSync(saved)).toBe(true);
    expect(statSync(saved).size).toBe(big.total);
    expect(partsIn(dir).length).toBe(0);
  } finally {
    await big.close();
  }
});

test('"Annulla" ferma davvero il trasferimento e non lascia file a metà', async ({ app, shell, openTab, testServer }) => {
  const media = await slowServer({ chunk: 128 * 1024, chunks: 60, gapMs: 100, contentType: 'video/mp4' });
  try {
    const page = await testServer.openReady(openTab, pageWithVideo(media.url('lungo.mp4')));
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

    await saveVideo(page);

    // Aspetta che sia davvero partito, poi annulla dalla barra.
    const id = await (async () => {
      let found = null;
      await expect.poll(async () => {
        const r = await shell.evaluate(() => window.filoShell.downloads.list());
        const e = ((r && r.items) || []).find((it) => it.filename === 'lungo.mp4' && it.state === 'progressing' && it.receivedBytes > 0);
        if (e) found = e.id;
        return !!found;
      }, { timeout: 15000 }).toBe(true);
      return found;
    })();
    await shell.evaluate((x) => window.filoShell.downloads.cancel(x), id);

    // La voce risulta annullata, il file di lavoro sparisce e il filmato NON
    // viene salvato (annullare a metà non deve lasciare un file rotto).
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.id === id);
      return e ? e.state : null;
    }, { timeout: 15000 }).toBe('cancelled');
    await expect.poll(() => partsIn(dir).length, { timeout: 15000 }).toBe(0);
    expect(existsSync(join(dir, 'lungo.mp4'))).toBe(false);

    // Annullare è una scelta dell'utente, non un guasto: niente avviso d'errore.
    await expect(page.locator('.sn-toast')).toHaveCount(0);
  } finally {
    await media.close();
  }
});
