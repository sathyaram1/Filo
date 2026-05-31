import { test, expect } from './fixtures/electron.mjs';

// Standalone: a bare BrowserWindow with NO Filo content script. Does the
// webContents 'context-menu' event fire for a misspelled word, and does
// renderer preventDefault suppress it?
test('PROBE2: does webContents context-menu fire with/without preventDefault', async ({ app }) => {
  const result = await app.evaluate(async ({ BrowserWindow, session }) => {
    session.defaultSession.setSpellCheckerLanguages(['it', 'en-US']);
    const out = { withPrevent: null, withoutPrevent: null };

    async function run(prevent) {
      const win = new BrowserWindow({ show: false, webPreferences: { spellcheck: true } });
      const html = `<!doctype html><body><div id="ce" contenteditable lang="it"
        style="font:20px monospace;width:300px;height:80px">ciiao</div>
        <script>
          document.addEventListener('contextmenu', (e) => { if (${prevent}) e.preventDefault(); });
        </script></body>`;
      await win.webContents.loadURL('data:text/html,' + encodeURIComponent(html));
      await new Promise((r) => setTimeout(r, 500));
      let fired = null;
      win.webContents.on('context-menu', (_e, p) => {
        fired = { misspelledWord: p.misspelledWord, dictionarySuggestions: p.dictionarySuggestions };
      });
      // focus the editable then send a real mouse right-click via input events
      win.webContents.focus();
      await win.webContents.executeJavaScript('document.getElementById("ce").focus(); document.getElementById("ce").click();');
      await new Promise((r) => setTimeout(r, 200));
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 20, y: 25, button: 'right', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 20, y: 25, button: 'right', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 600));
      win.destroy();
      return fired;
    }

    out.withoutPrevent = await run(false);
    out.withPrevent = await run(true);
    return out;
  });
  console.log('PROBE2_RESULT=' + JSON.stringify(result));
});
