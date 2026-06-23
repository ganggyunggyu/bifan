import { expect, test, type Page } from '@playwright/test';

async function waitForScanReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const screen = document.querySelector('.ar-animation-page');
    return (
      screen?.getAttribute('data-scan-state') === 'ready' &&
      screen?.getAttribute('data-prop-loaded') === '17' &&
      screen?.getAttribute('data-prop-failed') === '0'
    );
  }, null, { timeout: 30_000 });
}

test('AR timeline plays full chameleon before GLB props', async ({ page }) => {
  await page.goto(`/?ui=ar-timeline-${Date.now()}#/ar-animation`);
  await waitForScanReady(page);

  await page.locator('.ar-scan-button').click();
  await page.waitForTimeout(3_000);

  const screen = page.locator('.ar-animation-page');
  await expect(screen).toHaveAttribute('data-phase', 'props');
  await expect(screen).toHaveAttribute('data-prop-png-sequence-visible', '1');
  await expect(screen).toHaveAttribute('data-prop-visible', '1');
  await expect(screen).toHaveAttribute('data-prop-visible-items', /카멜레온 C05/);
  await expect(screen).toHaveAttribute('data-prop-visible-items', /"opacity":1/);

  await page.waitForTimeout(6_500);

  await expect(screen).toHaveAttribute('data-prop-png-sequence-visible', '0');
  await expect(screen).toHaveAttribute('data-prop-visible-items', /Megaphone_Ani_v02\.glb/);
});
