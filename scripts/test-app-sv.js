const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    console.log("Navigating to app...");
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    await page.goto('http://localhost:8080');
    
    console.log("Clicking example route...");
    await page.evaluate(() => {
      document.querySelector('.example-chip').click();
    });
    
    console.log("Waiting for network idle...");
    await page.waitForLoadState('networkidle');
    
    console.log("Taking screenshot of the DOM...");
    await page.screenshot({ path: 'sv-debug-after.png', fullPage: true });

    const isVisible = await page.isVisible('#btn-start');
    console.log("Is btn-start visible? ", isVisible);

    console.log("Waiting for Start Practice button...");
    await page.waitForSelector('#btn-start-practice', { state: 'visible' });
    await page.evaluate(() => {
      document.querySelector('#btn-start-practice').click();
    });
    
    console.log("Waiting for Pass 1...");
    await page.waitForTimeout(2000);
    
    console.log("Taking screenshot of Pass 1...");
    await page.screenshot({ path: 'sv-debug-pass1.png', fullPage: true });

    console.log("Switching to Pass 2 (Street View)...");
    // Click the Pass 2 button
    await page.click('button[data-pass="2"]', { force: true });
    
    console.log("Waiting for Street View to load...");
    await page.waitForTimeout(5000);
    
    console.log("Taking screenshot...");
    await page.screenshot({ path: 'sv-proof.png', fullPage: true });
    
    await browser.close();
    console.log("Screenshot saved to sv-proof.png");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
})();