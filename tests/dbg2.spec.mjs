import { test, expect } from './fixtures/electron.mjs';
test('debug reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.locator('.ed-module[data-type="switch"]').waitFor();
  await page.evaluate(() => {
    const doc = { meta:{title:'t',created:'x',modified:'x',version:1}, content:{type:'doc',content:[{type:'paragraph',content:[]}]}, comments:[], modules:[
      {id:'sw',type:'switch',cells:[{x:0,y:6,z:0},{x:1,y:6,z:0}],data:{activePage:0,pages:[{z:0,name:'P1',icon:'1'},{z:1,name:'P2',icon:'2'}]}},
      {id:'blk',type:'word-count',cells:[{x:2,y:6,z:1}],data:{count:'words'}},
      {id:'set',type:'settings',cells:[{x:6,y:9,z:0}],data:{}},
    ]};
    localStorage.setItem('filo.editor.doc', JSON.stringify(doc));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const url = page.url();
  let icons = -1;
  try { await page.locator('.ed-switch-icon').first().waitFor({timeout:4000}); icons = await page.locator('.ed-switch-icon').count(); } catch(e) { icons = -2; }
  console.log('DBG2', JSON.stringify({url, icons}));
});
