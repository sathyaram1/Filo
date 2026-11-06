// #1985 giro 2, r3: i link d'uscita che il riconoscimento per parole lascia passare.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const USCITE = [
  ['/user/loginOut', 'Sign out'.replace('Sign out', '退出登录')],
  ['/session/exit', '⏻'],
  ['/konto/vyhod', 'Выйти'],
  ['/mypage/rogu', 'ログアウト'],
  ['/konto/ut', 'Logga ut'],
  ['/area/fine', 'Termina sessione'],
];

test('r3 a pagina ferma e al passaggio del mouse non partono link d\'uscita scritti in altre lingue o alfabeti', async ({ openTab }) => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push(decodeURIComponent(req.url));
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const nav = USCITE.map(([u, t], i) => `<a id="u${i}" style="display:block;height:18px" href="${u}">${t}</a>`).join('');
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><a style="display:block" href="/area/profilo">Profilo</a>${nav}</body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/area`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    for (let i = 0; i < USCITE.length; i++) { await page.hover(`#u${i}`); await page.waitForTimeout(250); }
    await expect.poll(() => richieste.includes('/area/profilo'), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(4000);
    expect(richieste.filter((u) => USCITE.some(([x]) => x === u))).toEqual([]);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
