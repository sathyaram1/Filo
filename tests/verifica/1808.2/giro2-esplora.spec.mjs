// Verifica #1808.2 giro 2: esplorazione delle varianti dei quattro rilievi della segnalazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { apriEsatta, schede, archiviaTutto } from './sito.mjs';

test.describe.configure({ timeout: 300_000 });

const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso, qs] = req.url.split('?');
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const html = (s, t) => { res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(t); };
      const p = new URLSearchParams(req.method === 'POST' ? corpo : qs || '');
      if (percorso === '/err500') return html(500, '<!doctype html><title>Errore</title><p>Errore del server');
      if (percorso === '/err422') return html(422, '<!doctype html><title>Errore</title><p>Messaggio non valido');
      if (percorso === '/ok') { res.writeHead(302, { Location: '/fatto' }); res.end(); return; }
      if (percorso === '/fatto') return html(200, '<!doctype html><title>Fatto</title><p>Ricevuto');
      if (percorso === '/forum') {
        const k = p.get('k') || '';
        if (p.get('captcha') === '42') { res.writeHead(302, { Location: `/discussione?k=${k}` }); res.end(); return; }
        const invio = p.get('invio') || 'script';
        return html(200, `<!doctype html><title>Rispondi${k}</title><p class="err">Il codice di verifica non è corretto, riprova</p>
          <form id="f" method="post" action="/forum"><input type="hidden" name="k" value="${esc(k)}">
          <input id="ogg" name="oggetto" value="${esc(p.get('oggetto') || '')}">
          <textarea id="c" name="messaggio" style="width:400px;height:100px">${esc(p.get('messaggio') || '')}</textarea>
          <input id="cap" name="captcha"><a href="#" id="pub" onclick="f.submit();return false">Pubblica</a></form>`);
      }
      if (percorso === '/discussione') return html(200, `<!doctype html><title>Discussione${p.get('k') || ''}</title><p>Messaggio pubblicato`);
      if (percorso === '/cerca') return html(200, `<!doctype html><title>Risultati${p.get('k') || ''}</title><form action="/cerca"><input name="q" value="${esc(p.get('q') || '')}"></form><ul><li>uno<li>due</ul>`);
      const pg = pagine.get(percorso.replace(/^\//, ''));
      if (!pg) { res.writeHead(404); res.end('no'); return; }
      html(200, pg);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    pagina(h) { const id = `p${++n}`; pagine.set(id, h); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

async function sporca(shell, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
  return (await schede(shell)).find((t) => t.title === titolo).id;
}
const titoloDi = async (shell, id) => (await schede(shell)).find((t) => t.id === id)?.title;

// Rilievo 2 della segnalazione: invio da script con varianti, rimandato indietro col testo e un errore.
test('forum rimandato indietro: varianti di invio e di testo', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const respinti = {};
    const arrivati = {};
    const casi = [
      ['bottone', 'button', LETTERA, 0],
      ['f.submit subito', 'submit', LETTERA, 0],
      ['f.submit dopo la pausa', 'submit', LETTERA, 3000],
      ['requestSubmit', 'request', LETTERA, 0],
      ['click da script su bottone nascosto', 'clickhidden', LETTERA, 0],
      ['invio ritardato dalla pagina', 'ritardo', LETTERA, 0],
      ['messaggio corto', 'submit', 'Grazie a tutti!', 0],
      ['caratteri speciali', 'submit', 'Ciao <b>"Marco"</b> & co. l’idea è 👍 ottima, ne parliamo sabato?', 0],
      ['più righe', 'submit', 'Prima riga del messaggio al forum\nSeconda riga con altri dettagli utili', 0],
      ['oggetto e messaggio', 'submit', LETTERA, 0, true],
    ];
    let k = 0;
    for (const [nome, modo, testo, pausa, oggetto] of casi) {
      const kk = ++k;
      const titolo = `Nuovo${kk}`;
      const invio = {
        button: '<button id="pub">Invia</button>',
        submit: '<a href="#" id="pub" onclick="f.submit();return false">Pubblica</a>',
        request: '<a href="#" id="pub" onclick="f.requestSubmit();return false">Pubblica</a>',
        clickhidden: '<button id="nasc" style="display:none">x</button><a href="#" id="pub" onclick="nasc.click();return false">Pubblica</a>',
        ritardo: '<a href="#" id="pub" onclick="setTimeout(() => f.submit(), 1200);return false">Pubblica</a>',
      }[modo];
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="/forum"><input type="hidden" name="k" value="${kk}">
        ${oggetto ? '<input id="ogg" name="oggetto">' : ''}
        <textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea><input id="cap" name="captcha">${invio}</form>`));
      if (oggetto) { await page.locator('#ogg').click(); await page.keyboard.type('Rimborso ordine'); }
      await page.locator('#c').click();
      for (const [i, riga] of testo.split('\n').entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(riga); }
      await page.locator('#cap').click();
      await page.keyboard.type('41');
      const id = await sporca(shell, titolo);
      if (pausa) await page.waitForTimeout(pausa);
      await page.locator('#pub').click();
      await expect.poll(() => titoloDi(shell, id), { timeout: 10_000 }).toBe(`Rispondi${kk}`);
      await page.waitForTimeout(800);
      respinti[nome] = id;
    }
    // Respinto e poi rimandato bene dallo script: la scheda non resta protetta per sempre.
    {
      const kk = ++k;
      const titolo = `Nuovo${kk}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="/forum"><input type="hidden" name="k" value="${kk}">
        <textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea><input id="cap" name="captcha"><a href="#" id="pub" onclick="f.submit();return false">Pubblica</a></form>`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      const id = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await expect.poll(() => titoloDi(shell, id), { timeout: 10_000 }).toBe(`Rispondi${kk}`);
      await page.waitForTimeout(800);
      let p2 = null;
      for (const w of app.windows()) { try { if (w.url().endsWith('/forum') && (await w.title()) === `Rispondi${kk}`) p2 = w; } catch (_) {} }
      await p2.locator('#cap').click();
      await p2.keyboard.type('42');
      await p2.locator('#pub').click();
      await expect.poll(() => titoloDi(shell, id), { timeout: 10_000 }).toBe(`Discussione${kk}`);
      await p2.waitForTimeout(800);
      arrivati['respinto poi rimandato bene'] = id;
    }
    // Una ricerca mandata da uno script, coi risultati e la ricerca nella casella: non è un messaggio.
    {
      const kk = ++k;
      const titolo = `Cerca${kk}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" action="/cerca"><input type="hidden" name="k" value="${kk}"><input id="q" name="q"><a href="#" id="pub" onclick="f.submit();return false">Vai</a></form>`));
      await page.locator('#q').click();
      await page.keyboard.type('ricetta lasagne vegetariane');
      await page.locator('#pub').click();
      await expect.poll(async () => (await schede(shell)).some((s) => s.title === `Risultati${kk}`), { timeout: 10_000 }).toBe(true);
      await page.waitForTimeout(1500);
      arrivati['ricerca da script'] = (await schede(shell)).find((s) => s.title === `Risultati${kk}`).id;
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
    for (const [nome, id] of Object.entries(arrivati)) expect.soft(aperte, `arrivato: ${nome}`).not.toContain(id);
  } finally { await sito.chiudi(); }
});

// Rilievo 1 della segnalazione: editor in un riquadro nato con srcdoc, varianti.
test('editor in un riquadro nato col contenuto: varianti', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const respinti = {};
    const arrivati = {};
    const RIQ_BODY = '<iframe id="ifr" style="width:420px;height:140px" srcdoc="<body contenteditable=true style=\'min-height:120px\'></body>"></iframe>';
    const RIQ_DIV = '<iframe id="ifr" style="width:420px;height:140px" srcdoc="<body><div id=ed contenteditable=true style=\'min-height:120px\'></div></body>"></iframe>';
    const RIQ_BOZZA = '<iframe id="ifr" style="width:420px;height:140px" srcdoc="<body contenteditable=true style=\'min-height:120px\'><p>Marco ha scritto: ci vediamo alle otto</p><p><br></p></body>"></iframe>';
    const RIQ_P = '<iframe id="ifr" style="width:420px;height:140px" srcdoc="<body contenteditable=true style=\'min-height:120px\'><p><br></p></body>"></iframe>';
    const corpo = { body: 'ifr.contentDocument.body', div: 'ifr.contentDocument.getElementById("ed")' };
    const casi = [
      ['div modificabile, innerText, bottone, 500', RIQ_DIV, 'div', 'innerText', 'button', '/err500', 'Errore', respinti, LETTERA],
      ['corpo, requestSubmit, 422', RIQ_BODY, 'body', 'innerHTML', 'request', '/err422', 'Errore', respinti, LETTERA],
      ['corpo con paragrafo vuoto, script, 500', RIQ_P, 'body', 'innerHTML', 'submit', '/err500', 'Errore', respinti, LETTERA],
      ['corpo con citazione già scritta, script, 500', RIQ_BOZZA, 'body', 'innerHTML', 'submit', '/err500', 'Errore', respinti, LETTERA],
      ['più paragrafi, script, 500', RIQ_BODY, 'body', 'innerHTML', 'submit', '/err500', 'Errore', respinti, 'Primo paragrafo della lettera di reclamo\nSecondo paragrafo con il numero dell’ordine 4471'],
      ['campo nascosto di una riga, innerText, script, 500', RIQ_BODY, 'body', 'innerText', 'submit', '/err500', 'Errore', respinti, LETTERA],
      ['div modificabile, script, arrivato', RIQ_DIV, 'div', 'innerText', 'submit', '/ok', 'Fatto', arrivati, LETTERA],
      ['citazione già scritta, arrivato', RIQ_BOZZA, 'body', 'innerHTML', 'submit', '/ok', 'Fatto', arrivati, LETTERA],
      ['più paragrafi, arrivato', RIQ_BODY, 'body', 'innerHTML', 'submit', '/ok', 'Fatto', arrivati, 'Primo paragrafo della lettera di reclamo\nSecondo paragrafo con il numero dell’ordine 4471'],
    ];
    let k = 0;
    for (const [nome, riq, dove, prop, modo, azione, attesa, cesto, testo] of casi) {
      const titolo = `Ed${++k}`;
      const campo = nome.includes('una riga') ? '<input type="hidden" name="corpo" id="nasc">' : '<textarea name="corpo" id="nasc" style="display:none"></textarea>';
      const el = { button: '<button id="pub">Invia</button>', submit: '<a href="#" id="pub">Pubblica</a>', request: '<a href="#" id="pub">Pubblica</a>' }[modo];
      const script = modo === 'button'
        ? `f.addEventListener('submit', () => { nasc.value = ${corpo[dove]}.${prop}; });`
        : `pub.onclick = (e) => { e.preventDefault(); nasc.value = ${corpo[dove]}.${prop}; ${modo === 'request' ? 'f.requestSubmit()' : 'f.submit()'}; };`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="${azione}">${campo}${riq}${el}</form><script>${script}</script>`));
      await page.waitForTimeout(400);
      const bersaglio = dove === 'div' ? page.frameLocator('#ifr').locator('#ed') : page.frameLocator('#ifr').locator('body');
      await bersaglio.click();
      if (riq === RIQ_BOZZA) await page.keyboard.press('Control+End');
      for (const [i, riga] of testo.split('\n').entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(riga); }
      const id = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await expect.poll(() => titoloDi(shell, id), { timeout: 10_000 }).toBe(attesa);
      await page.waitForTimeout(800);
      cesto[nome] = id;
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
    for (const [nome, id] of Object.entries(arrivati)) expect.soft(aperte, `arrivato: ${nome}`).not.toContain(id);
  } finally { await sito.chiudi(); }
});

// Rilievo 3 della segnalazione: casella di ricerca a una riga col nome tipico, fuori da un modulo di ricerca, senza risultati dal vivo.
test('casella di ricerca a una riga col nome tipico: archiviata; casella alta con lo stesso nome: protetta', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ricerche = {
      'rows=1 come i motori': '<div><textarea id="q" name="q" rows="1" style="width:480px;resize:none;overflow:hidden"></textarea></div>',
      'rows=1 in un modulo qualunque': '<form action="/x" method="get"><textarea id="q" name="q" rows="1" style="width:480px"></textarea></form>',
      'senza rows, altezza da css': '<div><textarea id="q" name="query" style="width:480px;height:1.4em;line-height:1.4em;resize:none"></textarea></div>',
    };
    const messaggi = {
      'alta col nome q': '<div><textarea id="q" name="q" rows="6" style="width:480px"></textarea></div>',
    };
    const ids = { ricerche: {}, messaggi: {} };
    let k = 0;
    for (const [gruppo, elenco, testo] of [['ricerche', ricerche, 'ricetta lasagne vegetariane al forno'], ['messaggi', messaggi, LETTERA]]) {
      for (const [nome, campo] of Object.entries(elenco)) {
        const titolo = `Rq${++k}`;
        const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>${campo}`));
        await page.locator('#q').click();
        await page.keyboard.type(testo);
        await page.waitForTimeout(1500);
        ids[gruppo][nome] = (await schede(shell)).find((t) => t.title === titolo).id;
      }
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids.ricerche)) expect.soft(aperte, `ricerca: ${nome}`).not.toContain(id);
    for (const [nome, id] of Object.entries(ids.messaggi)) expect.soft(aperte, `messaggio: ${nome}`).toContain(id);
  } finally { await sito.chiudi(); }
});
