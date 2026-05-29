import { test, expect } from './fixtures/electron.mjs';

test('dbg', async ({ openTab }) => {
  const dash = await openTab('filo://newtab/');
  await dash.waitForSelector('#dash', { timeout: 8000 });
  const measure = (scale) => dash.evaluate((s) => {
    window.SN_PAGE_BOOTSTRAP.applyTextScale(s);
    const html = document.documentElement;
    const right = document.querySelector('.dash-right');
    const dashEl = document.getElementById('dash');
    return {
      scale: s,
      innerW: window.innerWidth, innerH: window.innerHeight,
      scrollW: html.scrollWidth, scrollH: html.scrollHeight, clientH: html.clientHeight,
      gridCols: getComputedStyle(dashEl).gridTemplateColumns,
      rightW: Math.round(right.getBoundingClientRect().width),
      rightRight: Math.round(right.getBoundingClientRect().right),
    };
  }, scale);
  console.log('SCALE1', JSON.stringify(await measure(1)));
  console.log('SCALE15', JSON.stringify(await measure(1.5)));
});
