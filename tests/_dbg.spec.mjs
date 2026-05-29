import { test, expect } from './fixtures/electron.mjs';

test('dbg', async ({ openTab }) => {
  const dash = await openTab('filo://newtab/');
  await dash.waitForSelector('#dash', { timeout: 8000 });
  const info = await dash.evaluate(() => {
    window.SN_PAGE_BOOTSTRAP.applyTextScale(1.5);
    const html = document.documentElement;
    const body = document.body;
    const dashEl = document.getElementById('dash');
    const rect = (el) => { const r = el.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
    return {
      innerH: window.innerHeight, innerW: window.innerWidth,
      scrollW: html.scrollWidth, clientW: html.clientWidth,
      htmlScroll: html.scrollHeight, htmlClient: html.clientHeight,
      htmlH: rect(html), bodyH: rect(body), dashH: rect(dashEl),
      htmlCss: getComputedStyle(html).height, htmlMinCss: getComputedStyle(html).minHeight,
      bodyCss: getComputedStyle(body).height, bodyMinCss: getComputedStyle(body).minHeight,
      dashMinCss: getComputedStyle(dashEl).minHeight,
    };
  });
  console.log(JSON.stringify(info, null, 2));
});
