// #589.4 giro 3, rilievo 1: il menu Incolla aperto dall'utente deve mostrare la cronologia anche dove la pagina annulla il tasto destro
// (resta il riquadro di un altro sito; Shift+F10 sulla pagina è chiuso in tests/appunti-dai-siti.spec.mjs).
import { test, expect } from '../../fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';
const CAMPO = '<!doctype html><html><body style="padding:40px"><button id="ok">Accetta</button><textarea id="ta" rows="5" cols="50"></textarea></body></html>';
const BLOCCA = "<script>window.addEventListener('contextmenu', (e) => e.preventDefault(), true);</script></body>";

async function copiaPassword(shell) {
  await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
}

test('riquadro che annulla il tasto destro: il menu Incolla mostra la cronologia', async ({ shell, openTab, testServer }) => {
  test.fail(true, '#589.4: Dove la pagina blocca il tasto destro, il menu Incolla aperto dall\'utente resta senza cronologia (resta il riquadro di un altro sito: lì Filo non vede il tasto destro se non dal segnale che la pagina annulla).');
  await copiaPassword(shell);
  const dentro = testServer.html(CAMPO.replace('</body>', BLOCCA)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  const fl = page.frameLocator('#embed');
  await fl.locator('#ta').click({ button: 'right' });
  await expect(fl.locator('.sn-menu[role=menu]')).toBeVisible();
  await fl.locator('.sn-menu-paste-arrow').click();
  await expect(fl.locator('.sn-menu-history-sub')).toContainText(PASSWORD);
});
