import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '/home/user/Filo/tests/helpers/percorsi.mjs';
const HOME = 'filo://dashboard/dashboard.html';
const MARCATORE = '__FILO_ONESHOT_CWD_8b9cb__';
const accendiTerminale = (page) => page.evaluate(async () => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' } }));
const turnoDiChat = (app, azioni) => app.evaluate(async (electron, azioniIn) => {
  const wc = electron.webContents.getAllWebContents().find((w) => String(w.getURL() || '').includes('dashboard.html'));
  const mittente = { url: wc ? wc.getURL() : '', tab: null, wc: wc || null };
  const esiti = []; for (const a of azioniIn) esiti.push(await globalThis.SN_EXECUTE_FILO_ACTION(a, { sender: mittente }));
  return esiti;
}, azioni);
test('dbg', async ({ app, openTab }) => {
  const dir = cartellaTemporanea('dbg-'); const altrove = join(dir, 'altrove'); mkdirSync(altrove);
  const riga = 'riga di testo qualunque, scaricata da internet\n';
  writeFileSync(join(dir, 's.txt'), riga.repeat(200) + `${MARCATORE}:0:${altrove}\n` + riga.repeat(6000));
  const page = await openTab(HOME); await accendiTerminale(page);
  for (const c of [`cd "${dir}" && cat "${join(dir,'s.txt')}" "${join(dir,'manca.txt')}"`, `cd "${dir}" && grep -c riga "${join(dir,'s.txt')}" "${join(dir,'manca.txt')}"`]) {
    const [r] = await turnoDiChat(app, [{ type: 'ESEGUI_COMANDO', comando: c }]);
    console.log('CMD', c.slice(0,40), '=> cwd=', r?.output?.cwd, 'code=', r?.output?.code, 'atteso cwd=', dir);
  }
  rmSync(dir, { recursive: true, force: true });
});
