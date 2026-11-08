// #2299, verifica giro 4, rilievo 2: gli editor ricchi che scrivono da sé il tasto dell'utente (fermano il `beforeinput`
// e mettono il carattere nel loro modello, come fanno gli editor delle chat e dei social) restano senza segni.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { segniDi } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ed" contenteditable="true" lang="it" style="width:600px;min-height:120px;font:20px sans-serif;border:1px solid #999"><p><br></p></div>
<script>
  const ed = document.getElementById('ed');
  // Il modello dell'editor: il testo del paragrafo, riscritto a ogni tasto col cursore in fondo.
  let testo = '';
  const disegna = () => {
    const p = ed.firstElementChild;
    p.textContent = testo;
    if (!testo) p.appendChild(document.createElement('br'));
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  ed.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertText') { e.preventDefault(); testo += e.data; disegna(); }
    else if (e.inputType === 'deleteContentBackward') { e.preventDefault(); testo = testo.slice(0, -1); disegna(); }
  });
</script>
</body>`;

test("r2 in un editor che scrive da sé i tasti dell'utente la parola sbagliata che l'utente batte riceve il segno", async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: false },
    });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.click('#ed');
  await page.keyboard.type('oggi quseta e domani ', { delay: 60 });
  await expect(page.locator('#ed')).toHaveText('oggi quseta e domani ');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 6000 });
});
