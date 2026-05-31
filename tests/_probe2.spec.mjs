import { test, expect } from './fixtures/electron.mjs';

test('PROBE2: real dictionarySuggestions without preventDefault', async ({ app }) => {
  const result = await app.evaluate(async ({ BrowserWindow, session }) => {
    session.defaultSession.setSpellCheckerLanguages(['it', 'en-US']);
    const win = new BrowserWindow({ show: false, webPreferences: { spellcheck: true } });
    const html = `<!doctype html><body><div id="ce" contenteditable lang="it"
      style="font:24px monospace;width:300px;height:80px;padding:4px">ciiao</div></body>`;
    await win.webContents.loadURL('data:text/html,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 1500)); // let spellchecker run
    win.webContents.focus();
    await win.webContents.executeJavaScript(`
      const el = document.getElementById('ce'); el.focus();
      const r = document.createRange(); r.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    `);
    await new Promise((r) => setTimeout(r, 500));
    let fired = 'NEVER';
    win.webContents.on('context-menu', (_e, p) => {
      fired = { misspelledWord: p.misspelledWord, dictionarySuggestions: p.dictionarySuggestions };
    });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 30, y: 25, button: 'right', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 30, y: 25, button: 'right', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 800));
    win.destroy();
    return fired;
  });
  console.log('PROBE2_RESULT=' + JSON.stringify(result));
});
