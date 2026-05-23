import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      // Test 1: append to <html> - does it survive?
      const div1 = document.createElement('div');
      div1.id = '__test_html';
      document.documentElement.appendChild(div1);

      // Test 2: append to <body> - does it survive?
      const div2 = document.createElement('div');
      div2.id = '__test_body';
      document.body.appendChild(div2);

      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            htmlChildSurvived: !!document.getElementById('__test_html'),
            bodyChildSurvived: !!document.getElementById('__test_body'),
          });
          try { div1.remove(); } catch(_){}
          try { div2.remove(); } catch(_){}
        }, 500);
      });
    });
    console.log('APPEND TEST:', JSON.stringify(result));
  }
} finally {
  await d.closeFilo(app);
}
