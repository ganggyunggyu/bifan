import { expect, test } from '@playwright/test';

test('root download button stays on download progress before routing', async ({ page }) => {
  await page.goto(`/?ui=root-download-${Date.now()}#/`);
  await expect(page.getByRole('button', { name: '다운로드' })).toBeVisible();

  await page.getByRole('button', { name: '다운로드' }).click();
  await page.waitForTimeout(1_000);

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.loading-page')).toHaveAttribute('data-download-state', 'running');
  await expect(page.getByText(/데이터 다운로드 중/)).toBeVisible();
});
