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
//  - la barra mostra il filmato in arrivo con una percentuale intermedia;
//  - un file più grande del vecchio tetto arriva integro;
//  - "Annulla" ferma davvero il trasferimento.
// Senza il fix: nessuna voce nella barra, nessun file parziale, e il file oltre
// il tetto non arriva mai → rosso.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Serve `chunk * chunks` byte a blocchi, con una pausa fra l'uno e l'altro: così
// il trasferimento dura abbastanza da poter essere osservato MENTRE accade (è
// esattamente la condizione del feedback — il file vero, non la clip di prova).
async function slowServer({ chunk, chunks, gapMs, contentType }) {
  const block = Buffer.alloc(chunk, 0x5a);
  const total = chunk * chunks;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': total });
    let i = 0;
    const tick = () => {
      if (res.writableEnded || res.destroyed) return;
      if (i >= chunks) { res.end(); return; }
      i++;
      const room = res.write(block);
      // Rispetta la contropressione: senza, il server accumulerebbe in RAM
      // proprio ciò che questo test vuole dimostrare superato.
      if (!room) res.once('drain', () => setTimeout(tick, gapMs));
      else setTimeout(tick, gapMs);
    };
    tick();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    total,
    url: (name) => `http://127.0.0.1:${srv.address().port}/${name}`,
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

const entryNamed = async (shell, name) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return ((r && r.items) || []).find((it) => it.filename === name) || null;
};

test('salvando un filmato il file cresce su disco e la barra ne mostra l\'avanzamento', async ({ app, shell, openTab, testServer }) => {
  // ~7,5MB in 30 blocchi da 200ms: ~6 secondi di trasferimento, abbastanza per
  // osservarlo senza che il test debba correre.
  const media = await slowServer({ chunk: 256 * 1024, chunks: 30, gapMs: 200, contentType: 'video/mp4' });
  try {
    const page = await testServer.openReady(openTab, pageWithVideo(media.url('filmato.mp4')));
    const pageUrl = page.url();
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(dir).toBeTruthy();

    await saveVideo(page);

    // 1) IL FILE ARRIVA SU DISCO MENTRE SCARICA — è il cuore del fix. Prima
    //    tutto restava in memoria fino all'ultimo byte: in questo istante non
    //    c'era niente su disco, e la memoria di Filo cresceva col filmato.
    await expect.poll(() => partsIn(dir).length, { timeout: 20000 }).toBeGreaterThan(0);
    const part = join(dir, partsIn(dir)[0]);
    await expect
      .poll(() => (existsSync(part) ? statSync(part).size : -1), { timeout: 20000 })
      .toBeGreaterThan(0);
    const firstSize = existsSync(part) ? statSync(part).size : 0;
    expect(firstSize).toBeLessThan(media.total); // il file c'è ed è ancora parziale

    // 2) L'AVANZAMENTO È MOSTRATO, e la barra in alto lo sta dicendo all'utente.
    //    Il primo istante utile viene "agganciato": il trasferimento prosegue
    //    mentre il test guarda, quindi ciò che conta è averlo visto in corso.
    let live = null;
    let bar = null;
    await expect.poll(async () => {
      const e = await entryNamed(shell, 'filmato.mp4');
      if (e && e.state === 'progressing' && e.receivedBytes > 0 && !live) {
        live = e;
        bar = await shell.evaluate(() => {
          const btn = document.getElementById('dl-btn');
          const fill = document.getElementById('dl-ind-fill');
          return {
            hidden: !!(btn && btn.hidden),
            active: !!(btn && btn.classList.contains('active')),
            width: fill ? fill.style.width : '',
          };
        });
      }
      return live ? 'in corso' : (e ? e.state : 'assente');
    }, { timeout: 20000 }).toBe('in corso');

    // Il peso dichiarato dal server è noto ⇒ l'avanzamento è una percentuale
    // vera, non una rotella: è ciò che il feedback chiedeva.
    expect(live.totalBytes).toBe(media.total);
    const percent = Math.round((live.receivedBytes / live.totalBytes) * 100);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan(100);
    expect(bar.hidden).toBe(false);
    expect(bar.active).toBe(true);
    expect(bar.width).not.toBe('');

    // 3) A fine corsa: il file completo, integro, e nessun file di lavoro in giro.
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 40000 })
      .toContain('filmato.mp4');
    await expect
      .poll(() => statSync(join(dir, 'filmato.mp4')).size, { timeout: 40000 })
      .toBe(media.total);
    await expect.poll(() => partsIn(dir).length, { timeout: 20000 }).toBe(0);
    await expect
      .poll(async () => { const e = await entryNamed(shell, 'filmato.mp4'); return e ? e.state : null; }, { timeout: 20000 })
      .toBe('completed');

    // La scheda non è navigata sul filmato e l'utente ha la sua conferma.
    expect(page.url()).toBe(pageUrl);
    await expect(page.locator('.sn-toast')).toContainText('Video salvato');
  } finally {
    await media.close();
  }
});

test('un filmato più grande del vecchio tetto in memoria arriva comunque, integro', async ({ app, openTab, testServer }) => {
  // 72MB: sopra il tetto anti-OOM che il salvataggio aveva (64MB per le
  // immagini; per i media era mezzo giga, stessa funzione e stesso limite di
  // progetto). Prima il salvataggio si fermava con "file troppo grande" perché
  // il file passava tutto dalla memoria; ora scende su disco a blocchi. Servito
  // a piena velocità: qui interessa la mole, non il tempo.
  const big = await slowServer({ chunk: 1024 * 1024, chunks: 72, gapMs: 0, contentType: 'video/mp4' });
  try {
    const page = await testServer.openReady(openTab, pageWithVideo(big.url('enorme.mp4')));
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

    await saveVideo(page);

    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 60000 })
      .toContain('enorme.mp4');
    expect(statSync(join(dir, 'enorme.mp4')).size).toBe(big.total);
    await expect.poll(() => partsIn(dir).length, { timeout: 20000 }).toBe(0);
    await expect(page.locator('.sn-toast')).toContainText('Video salvato');
  } finally {
    await big.close();
  }
});

test('"Annulla" ferma davvero il trasferimento e non lascia file a metà', async ({ app, shell, openTab, testServer }) => {
  const media = await slowServer({ chunk: 128 * 1024, chunks: 80, gapMs: 150, contentType: 'video/mp4' });
  try {
    const page = await testServer.openReady(openTab, pageWithVideo(media.url('lungo.mp4')));
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

    await saveVideo(page);

    // Aspetta che sia davvero partito, poi annulla dalla barra.
    let id = null;
    await expect.poll(async () => {
      const e = await entryNamed(shell, 'lungo.mp4');
      if (e && e.state === 'progressing' && e.receivedBytes > 0) id = e.id;
      return !!id;
    }, { timeout: 20000 }).toBe(true);
    await shell.evaluate((x) => window.filoShell.downloads.cancel(x), id);

    // La voce risulta annullata, il file di lavoro sparisce e il filmato NON
    // viene salvato (annullare a metà non deve lasciare un file rotto).
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.id === id);
      return e ? e.state : null;
    }, { timeout: 20000 }).toBe('cancelled');
    await expect.poll(() => partsIn(dir).length, { timeout: 20000 }).toBe(0);
    expect(existsSync(join(dir, 'lungo.mp4'))).toBe(false);

    // Annullare è una scelta dell'utente, non un guasto: niente avviso d'errore.
    await page.waitForTimeout(1000);
    await expect(page.locator('.sn-toast')).toHaveCount(0);
  } finally {
    await media.close();
  }
});
