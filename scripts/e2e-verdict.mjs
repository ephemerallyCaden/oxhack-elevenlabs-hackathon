import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage();

page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));

const phasesSeen = [];
function notePhase(p) {
  if (phasesSeen[phasesSeen.length - 1] !== p) {
    phasesSeen.push(p);
    console.log(`  phase → ${p}`);
  }
}

try {
  console.log('🎬 Full trial: question → debate → verdict\n');
  await page.goto('http://localhost:3000/trial');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.fill('input#typed', 'Should I quit my job to travel?');
  await page.click('button:has-text("Send")');
  console.log('✓ Question submitted\n');

  // Poll the page for up to 3 minutes, tracking phase via visible text
  const start = Date.now();
  let done = false;
  while (Date.now() - start < 180000) {
    const body = await page.locator('body').textContent();
    if (body.includes('preparing the case')) notePhase('preparing');
    else if (/Verdict|verdict/.test(body) && /adjourned|final|Transcript/i.test(body)) { notePhase('done'); done = true; break; }
    else if (body.includes('deliberates')) notePhase('thinking');
    else if (body.includes('PROSECUTION') || body.includes('DEFENSE')) notePhase('speaking');

    // also check for done-phase UI markers
    const doneMarker = await page.locator('text=/adjourned|play again|new question/i').count();
    if (doneMarker > 0) { notePhase('done'); done = true; break; }

    await page.waitForTimeout(2000);
  }

  console.log('\n📊 Phases seen:', phasesSeen.join(' → ') || '(none)');
  await page.screenshot({ path: 'trial-verdict.png', fullPage: true });
  console.log('📸 trial-verdict.png saved');

  if (done) {
    console.log('\n✅ FULL TRIAL COMPLETED — reached verdict/done');
  } else {
    const body = await page.locator('body').textContent();
    console.log('\n⚠️ Trial still running after 3 min. Last 300 chars of page:');
    console.log(body.slice(-300));
  }

} catch (error) {
  console.error('❌', error.message);
  await page.screenshot({ path: 'trial-error.png' });
} finally {
  await browser.close();
}
