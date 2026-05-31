import { test, expect } from './fixtures/electron.mjs';
async function drag(page, cols){
  const sc = page.locator('.ed-module[data-type="switch"]');
  await sc.hover();
  const h = page.locator('.ed-module[data-type="switch"] .ed-mod-resize-h');
  const box = await h.boundingBox();
  const cw = await page.evaluate(()=>document.getElementById('grid').clientWidth/7);
  const sx = box.x+box.width/2, sy=box.y+box.height/2, tx=sx+cw*cols;
  await page.mouse.move(sx,sy); await page.mouse.down();
  await page.mouse.move(sx+(tx-sx)*0.5,sy,{steps:4});
  await page.mouse.move(tx,sy,{steps:4});
  await page.mouse.up();
}
test('dbg toast', async ({ openTab }) => {
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
  await page.reload(); await page.waitForLoadState('domcontentloaded');
  await page.locator('.ed-switch-icon').first().waitFor();
  const before = await page.evaluate(()=>{
    const sw = JSON.parse(localStorage.getItem('filo.editor.doc')).modules.find(m=>m.type==='switch');
    return { swCells: sw.cells.length, swX: sw.cells[0].x };
  });
  await drag(page, 1);
  await page.waitForTimeout(500);
  const after = await page.evaluate(()=>({
    icons: document.querySelectorAll('.ed-switch-icon').length,
    toast: !!document.querySelector('#edToast'),
    toastShow: !!document.querySelector('#edToast.show'),
    toastText: document.querySelector('#edToast')?.textContent || null,
  }));
  console.log('DBG3', JSON.stringify({before, after}));
});
