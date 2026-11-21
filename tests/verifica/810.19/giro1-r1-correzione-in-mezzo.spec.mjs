// Verifica #810.19 giro 1, rilievo 1: una cifra corretta in mezzo, dove Filo non può confrontare il valore intero del
// campo (altro testo del sito fra due ritocchi, caselle dentro un componente), lascia il numero fra i segreti letti.
import { test, expect } from '../../fixtures/electron.mjs';
import { PAGAMENTO, preparaModelli, modelloFinto, oltreLAvviso, chiediEGuarda } from './aiuti.mjs';

const CARTA = '4111 1111 1111 1111';
const QUATTRO_IN_OMBRA = `<div id="disegno">•••• •••• •••• ••••</div><label>Numero della carta</label><span id="ospite"></span>
  <script>var r=document.getElementById('ospite').attachShadow({mode:'open'});
  r.innerHTML='<input id="c1" maxlength="4"><input id="c2" maxlength="4"><input id="c3" maxlength="4"><input id="c4" maxlength="4">';
  var cc=[1,2,3,4].map(function(i){return r.getElementById('c'+i);});
  cc.forEach(function(x,i){x.addEventListener('input',function(){
  document.getElementById('disegno').textContent=cc.map(function(y){return y.value||'••••';}).join(' ');
  if(x.value.length===4&&cc[i+1])cc[i+1].focus();});});</script>`;

for (const [come, corpo, scrivi, valore] of [
  ['la carta corretta in mezzo a una mail, con la firma ritoccata dopo',
    '<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid">Ciao Marco,<br><span id="qui"></span><br>A presto, Giulia</div>',
    async (page) => {
      await page.locator('#ed').click();
      await page.evaluate(() => { const r = document.createRange(); r.setStart(document.getElementById('qui'), 0); getSelection().removeAllRanges(); getSelection().addRange(r); });
      await page.keyboard.type('la carta è 4111 1111 1121 1111');
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('1');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Rossi');
      await expect(page.locator('#ed')).toContainText(`la carta è ${CARTA}`);
      await expect(page.locator('#ed')).toContainText('Giulia Rossi');
    }, CARTA],
  ['la carta in quattro caselle dentro un componente, con una cifra corretta nella seconda', QUATTRO_IN_OMBRA, async (page) => {
    await page.locator('#c1').click();
    await page.keyboard.type('4532015912830366', { delay: 20 });
    await page.locator('#c2').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('1');
    await expect(page.locator('#disegno')).toHaveText('4532 0151 1283 0366');
  }, '4532 0151 1283 0366'],
]) {
  test(`r1 ${come} non resta fra i segreti letti, né i suoi pezzi`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, PAGAMENTO(corpo));
    await oltreLAvviso(app);
    await preparaModelli(app);
    await modelloFinto(app);
    await scrivi(page);
    const dopo = await chiediEGuarda(app, shell, page);
    const v = valore.replace(/ /g, '').toLowerCase();
    expect(dopo.filter((x) => x.length >= 4 && v.includes(x)), 'il numero dell’utente o un suo pezzo è rimasto fra i segreti letti').toEqual([]);
  });
}
