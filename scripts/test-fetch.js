const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  await page.goto('http://localhost:8080');
  await page.evaluate(async () => {
    try {
      const r = await fetch('data/demo-routes/cached-example-0.json');
      const j = await r.json();
      console.log('FETCH SUCCESS:', !!j.isCachedState);
    } catch(e) {
      console.log('FETCH ERR:', e.message);
    }
  });
  await browser.close();
})();
