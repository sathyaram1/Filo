import { test, expect } from '../../fixtures/electron.mjs';

const FRASI = {
  corta: 'riassumi il secondo paragrafo',
  media: 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera',
  lunga: 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera formale a un cliente che si è lamentato del ritardo nella consegna, poi proponi tre alternative più cortesi',
  parolona: 'Supercalifragilistichespiralidosoprecipitevolissimevolmenteantidisestablishmentarianism e poi altre parole normali qui',
};

const TAGLIE = [];
for (const w of [960, 1024, 1100, 1180, 1230, 1280, 1330, 1366, 1400, 1440, 1536, 1600, 1920]) {
  for (const h of [600, 640, 690, 720, 768, 800, 864, 1040]) TAGLIE.push([w, h]);
}

test('esplora taglie', async ({ app, shell, openTab }) => {
  test.setTimeout(600_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  const casella = chat.locator('[data-chat="input"]');
  const righe = [];
  for (const [w, h] of TAGLIE) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows().find((x) => x.isVisible()).setSize(w, h); }, [w, h]);
    await ed.waitForTimeout(400);
    for (const [nome, f] of Object.entries(FRASI)) {
      await casella.fill('');
      await casella.fill(f);
      await ed.waitForTimeout(60);
      const m = await ed.evaluate(() => {
        const mod = document.querySelector('.ed-module[data-type="chat"]');
        const t = mod.querySelector('[data-chat="input"]');
        const M = mod.getBoundingClientRect();
        const T = t.getBoundingClientRect();
        const S = mod.querySelector('[data-chat="send"]').getBoundingClientRect();
        const V = mod.querySelector('.sn-voce-btn').getBoundingClientRect();
        const L = mod.querySelector('[data-chat="log"]').getBoundingClientRect();
        return {
          chatW: Math.round(M.width), chatH: Math.round(M.height), tW: Math.round(T.width), tH: Math.round(T.height),
          sh: t.scrollHeight, ch: t.clientHeight, sotto: S.top >= T.bottom - 1,
          dentro: S.bottom <= M.bottom + 0.5 && V.bottom <= M.bottom + 0.5 && S.right <= M.right + 0.5 && V.right <= M.right + 0.5,
          logH: Math.round(L.height), vw: innerWidth, vh: innerHeight,
        };
      });
      righe.push(`${w}x${h} ${nome.padEnd(8)} vp=${m.vw}x${m.vh} chat=${m.chatW}x${m.chatH} t=${m.tW}x${m.tH} sh/ch=${m.sh}/${m.ch} ${m.sh <= m.ch ? 'INTERA' : 'SCORRE'} ${m.sotto ? 'sotto' : 'accanto'} ${m.dentro ? '' : 'FUORI'} log=${m.logH}`);
    }
  }
  console.log('\n' + righe.join('\n'));
});
