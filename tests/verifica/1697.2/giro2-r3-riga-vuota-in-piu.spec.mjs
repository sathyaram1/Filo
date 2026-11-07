// #1697.2 giro 2, rilievo 3: un incolla lungo che finisce con un a capo, su una riga vuota, lascia una riga vuota in più
// dopo il testo rispetto all'incolla corto.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n') + '\n';

for (const [nome, html] of [
  ['fra due paragrafi', '<p>sopra</p><p><br></p><p>sotto</p>'],
  ['in fondo al foglio', '<p>sopra</p><p><br></p>'],
]) {
  test(`r3 su una riga vuota ${nome}: 100 righe con l'a capo in fondo lasciano le stesse righe vuote di 10`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await page.click('#doc');
    const vuoteDopo = async (n) => page.evaluate(({ html, t }) => {
      const doc = document.getElementById('doc');
      doc.innerHTML = html;
      doc.dispatchEvent(new Event('input', { bubbles: true }));
      getSelection().collapse(doc.querySelectorAll('p')[1], 0);
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      const blocchi = [...doc.children];
      const ultima = blocchi.findLastIndex((b) => /riga numero/.test(b.textContent));
      return blocchi.slice(ultima + 1).filter((b) => !b.textContent.trim()).length;
    }, { html, t: righe(n) });
    const corto = await vuoteDopo(10);
    const lungo = await vuoteDopo(100);
    expect(lungo).toBe(corto);
  });
}
