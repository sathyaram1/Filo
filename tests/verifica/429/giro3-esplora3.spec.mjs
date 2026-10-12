import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/429';
mkdirSync(SHOTS, { recursive: true });

const attiva = (shell) => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);

test('intestazione che si colora tardi', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, `<!doctype html><title>Tardi</title><body style="margin:0;background:#fff"><header id=h style="height:80px;background:#fff"></header>
  <script>setTimeout(()=>{document.getElementById('h').style.background='#1f7a3a';document.body.style.background='#1f7a3a'},3000)</script></body>`);
  await shell.waitForTimeout(1200);
  const prima = await attiva(shell);
  await shell.waitForTimeout(4000);
  const dopo = await attiva(shell);
  console.log('tardi', prima, dopo);
});

test('tema scuro dal sito', async ({ shell, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, `<!doctype html><title>Interruttore</title><body style="margin:0;background:#fff"><button id=b onclick="document.body.style.background='#111'">x</button></body>`);
  await shell.waitForTimeout(1200);
  const prima = await attiva(shell);
  await p.evaluate(() => { document.body.style.background = '#111'; });
  await shell.waitForTimeout(2500);
  console.log('interruttore', prima, await attiva(shell));
});

test('finestra stretta e hover', async ({ app, shell, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(720, 600); });
  for (const u of ['filo://manage/manage.html', 'filo://options/options.html', 'filo://history/history.html', 'filo://feedback/feedback.html', 'filo://board/board.html', 'filo://downloads/downloads.html', 'filo://archive/archive.html']) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  }
  await shell.waitForTimeout(2000);
  const leggi = () => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => `${t.querySelector('.title').textContent.slice(0, 10)}:${Math.round(t.getBoundingClientRect().width)}/${t.querySelector('.title').clientWidth}`).join(' | '));
  console.log('stretta', await leggi());
  await shell.screenshot({ path: `${SHOTS}/stretta.png` });
  await shell.hover('#tabs .tab:nth-child(3)');
  await shell.waitForTimeout(300);
  console.log('stretta-hover', await leggi());
  await shell.screenshot({ path: `${SHOTS}/stretta-hover.png` });
  await shell.waitForTimeout(1200);
  await shell.screenshot({ path: `${SHOTS}/stretta-hover2.png` });
});
