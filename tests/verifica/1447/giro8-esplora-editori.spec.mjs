// Esplorazione del giro 8 di verifica #1447: Quill (Slack, LinkedIn) e Draft.js (X), stampa il testo del modello.
import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const LIB = process.env.LIB_EDITORI;
const leggi = (p) => fs.readFileSync(`${LIB}/${p}`, 'utf8');

const QUILL = () => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${leggi('quill-2.0.3/package/dist/quill.js')}</script>
<script>window.q = new Quill('#m', {}); window.modello = () => window.q.getText().replace(/\\n$/, '');</script></body>`;

const DRAFT = () => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<style>.public-DraftEditor-content{white-space:pre-wrap}</style>
<div id="m" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${leggi('react-16.14.0/package/umd/react.production.min.js')}</script>
<script>${leggi('react-dom-16.14.0/package/umd/react-dom.production.min.js')}</script>
<script>${leggi('immutable-3.7.6/package/dist/immutable.min.js')}</script>
<script>${leggi('draft-js-0.11.7/package/dist/Draft.min.js')}</script>
<script>
const { Editor, EditorState } = Draft;
function App() {
  const [s, set] = React.useState(EditorState.createEmpty());
  window.modello = () => s.getCurrentContent().getPlainText();
  return React.createElement(Editor, { editorState: s, onChange: set });
}
ReactDOM.render(React.createElement(App), document.getElementById('m'));
</script></body>`;

const CK = () => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m"></div>
<script>${leggi('ck/package/build/ckeditor.js')}</script>
<script>ClassicEditor.create(document.getElementById('m'), { toolbar: [] }).then((ed) => { window.ed = ed; window.modello = () => ed.getData().replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '); });</script></body>`;

const IFRAME = () => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<iframe id="f" style="width:700px;height:200px" srcdoc="<html lang=it><body contenteditable=true style='font:22px sans-serif'></body></html>"></iframe>
<script>window.modello = () => document.getElementById('f').contentDocument.body.innerText;</script></body>`;

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

for (const [nome, html, sel] of [['ck', CK, '.ck-editor__editable'], ['iframe', IFRAME, null]]) {
  test(`esplora ${nome}`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, html());
    const m = () => page.evaluate(() => window.modello().replace(/ /g, ' '));
    const dom = () => !sel ? m() : page.evaluate((s) => document.querySelector(s).innerText.replace(/ /g, ' '), sel);
    const log = [];
    await page.waitForTimeout(1000);
    if (sel) await page.locator(sel).click();
    else await page.frameLocator('#f').locator('body').click();
    await page.keyboard.type('Ciao marco come va, non so perchè ');
    await page.waitForTimeout(400);
    log.push(`dopo scritto: modello=${JSON.stringify(await m())} dom=${JSON.stringify(await dom())}`);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    log.push(`dopo annulla: modello=${JSON.stringify(await m())} dom=${JSON.stringify(await dom())}`);
    await page.keyboard.type('ok fine ');
    await page.waitForTimeout(300);
    log.push(`dopo fine: modello=${JSON.stringify(await m())} dom=${JSON.stringify(await dom())}`);
    console.log(`\n[${nome}]\n` + log.join('\n'));
  });
}
