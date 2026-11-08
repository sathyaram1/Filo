// #2294 giro 5 — esplorazione: porte non ancora provate del freno sui file senza clic (riquadro di un altro sito,
// riquadro nascosto che naviga sul file, finestra aperta da sola, navigazione della pagina intera sul file).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });
const SITI = ['ospite.test', 'riquadro.test'];
test.use({ hostInPiu: SITI });

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const porta = srv.address().port;
    if (u.pathname.startsWith('/file-')) {
      const corpo = Buffer.from(`file ${u.pathname}\n`);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': corpo.length, 'Content-Disposition': `attachment; filename="${u.pathname.slice(1)}"` });
      res.end(corpo);
      return;
    }
    const n = Number(u.searchParams.get('n') || 4);
    const p = u.searchParams.get('p') || 'x';
    let corpo = '';
    if (u.pathname === '/ospita') {
      corpo = `<h1>Ospite</h1><iframe src="http://${SITI[1]}:${porta}/dentro?n=${n}&p=${p}" width="300" height="100"></iframe>`;
    } else if (u.pathname === '/dentro') {
      corpo = `<p>riquadro</p><script>let i=0;const t=setInterval(()=>{if(i>=${n}){clearInterval(t);return;}const a=document.createElement('a');a.href='/file-${p}-'+(i++)+'.bin';a.download='';document.body.appendChild(a);a.click();},400);</script>`;
    } else if (u.pathname === '/nascosto') {
      corpo = `<h1>Riquadri nascosti</h1><script>let i=0;const t=setInterval(()=>{if(i>=${n}){clearInterval(t);return;}const f=document.createElement('iframe');f.style.display='none';f.src='/file-${p}-'+(i++)+'.bin';document.body.appendChild(f);},400);</script>`;
    } else if (u.pathname === '/finestra') {
      corpo = `<h1>Finestre</h1><script>let i=0;const t=setInterval(()=>{if(i>=${n}){clearInterval(t);return;}window.open('/file-${p}-'+(i++)+'.bin');},500);</script>`;
    } else if (u.pathname === '/intera') {
      corpo = `<h1>Pagina intera</h1><script>let i=0;const t=setInterval(()=>{if(i>=${n}){clearInterval(t);return;}location.href='/file-${p}-'+(i++)+'.bin';},500);</script>`;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Prova</title></head><body>${corpo}</body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const arrivati = (dir, segno) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(segno)) : []);
const inAttesa = (shell, segno) => shell.evaluate(async (s) => {
  const r = await window.filoShell.downloads.list();
  return ((r && r.items) || []).filter((it) => String(it.filename || '').includes(s) && it.state === 'pending').length;
}, segno);

for (const [via, percorso] of [['riquadro di un altro sito', 'ospita'], ['riquadri nascosti sul file', 'nascosto'], ['finestre aperte da sole', 'finestra'], ['pagina intera sul file', 'intera']]) {
  test(`${via}: arriva al più un file, gli altri aspettano o non partono`, async ({ app, shell, openTab }) => {
    test.setTimeout(90_000);
    const srv = await apriServer();
    try {
      const dir = await cartella(app);
      const p = `e${percorso}`;
      await openTab(`http://${SITI[0]}:${srv.porta}/${percorso}?n=4&p=${p}`);
      await new Promise((r) => setTimeout(r, 6_000));
      const fatti = arrivati(dir, p);
      const attesa = await inAttesa(shell, p);
      await shell.screenshot({ path: `${SHOTS}/2294-g5-${percorso}.png` });
      console.log(via, JSON.stringify({ fatti, attesa }));
      expect(fatti.length).toBeLessThanOrEqual(1);
    } finally {
      await srv.close();
    }
  });
}
