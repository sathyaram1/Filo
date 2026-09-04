// VERIFICA INDIPENDENTE (2° giro) — da cancellare a fine verifica.
// I tre cammini principali, dal vivo con chiave vera.
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];

async function setKey(openTab) {
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(KEY);
  await opt.locator('#apiKey').blur();
  await opt.waitForTimeout(2500);
  return opt;
}

test('lettura: dal tasto destro parte con la voce del modello, non di sistema', async ({ openTab, testServer }) => {
  test.setTimeout(300000);
  await setKey(openTab);
  const page = await testServer.openReady(openTab,
    '<html lang="it"><body style="padding:40px"><p id="t">Filo legge questo paragrafo ad alta voce con una voce naturale, e continua a leggere per parecchi secondi, perche il testo e lungo abbastanza da coprire una lettura di almeno mezzo minuto senza interruzioni di sorta, con molte parole e molte frasi in fila una dopo l altra.</p></body></html>');
  await page.locator('#t').click({ clickCount: 3 });
  await page.waitForTimeout(600);
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1500);
  await page.locator('text=Leggi').first().click();
  await page.waitForTimeout(6000);
  const toast = await page.evaluate(() =>
    [...document.querySelectorAll('.sn-toast')].map((e) => e.innerText));
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1500);
  const menu2 = await page.evaluate(() => {
    const m = document.querySelector('.sn-popup, [class*="sn-menu"]');
    return m ? m.innerText : '(niente)';
  });
  console.log('TOAST:', JSON.stringify(toast));
  console.log('MENU MENTRE LEGGE:', JSON.stringify(menu2));
  expect(menu2, 'sta leggendo davvero').toContain('Interrompi lettura');
  expect(toast.join(' ')).not.toMatch(/voce del (browser|sistema)|non disponibile/i);
});

test('archivio: la ricerca per senso trova la scheda giusta', async ({ openTab, testServer, shell }) => {
  test.setTimeout(300000);
  await setKey(openTab);
  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForTimeout(1500);
  const pagine = [
    { title: 'Come si pota un ulivo', text: 'Guida alla potatura degli olivi: rami secchi, vaso policonico, periodo migliore in tarda primavera.' },
    { title: 'Ricetta della carbonara', text: 'Guanciale, uova, pecorino romano e pepe nero. Niente panna. Cottura della pasta al dente.' },
    { title: 'Manutenzione dei freni a disco', text: 'Sostituzione delle pastiglie, spurgo del liquido, controllo del disco e dello spessore minimo.' },
  ];
  for (const p of pagine) {
    const url = testServer.html(`<html lang="it"><head><title>${p.title}</title></head><body><h1>${p.title}</h1><p>${p.text}</p></body></html>`);
    const page = await openTab(url);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    const u = page.url();
    await shell.evaluate(async (x) => {
      const s = await window.filoShell.tabs.snapshot();
      const t = (s.tabs || s).find((y) => y.url === x);
      if (t) await window.filoShell.tabs.close(t.id);
    }, u);
    await arc.waitForTimeout(2000);
  }
  await arc.waitForTimeout(30000);
  await arc.reload();
  await arc.waitForTimeout(2000);
  const box = arc.locator('#search');
  await box.fill('quale pasta preparo stasera');
  await box.press('Enter');
  await arc.waitForTimeout(20000);
  const nota = (await arc.locator('#searchNote').textContent() || '').trim();
  const primo = (await arc.locator('#list').innerText()).split('\n').filter(Boolean).slice(0, 6);
  console.log('NOTA:', nota);
  console.log('PRIMI RISULTATI:', JSON.stringify(primo));
  expect(nota).not.toContain('non disponibile');
  expect(primo.join(' ').toLowerCase()).toContain('carbonara');
});
