import { test, expect } from '@playwright/test';
import { authFile } from '../fixtures';

test.describe('Section A-ONE-WAY-IN', () => {
  test.use({ storageState: authFile('am') });

  test('A1 - open the door via shortcut', async ({ page }) => {
    await page.goto('/');
    
    // Press Ctrl/Cmd+P
    await page.locator('body').click();
    await page.keyboard.press('ControlOrMeta+p');

    await expect(page.getByTestId('new-request-door')).toBeVisible();
    await expect(page.getByTestId('new-request-single-job')).toBeVisible();
    await expect(page.getByTestId('new-request-full-campaign')).toBeVisible();
    
    await page.screenshot({ path: 'test-results/screenshots/A1.png' });
  });

  test('A2 - open the door via campaigns new button', async ({ page }) => {
    await page.goto('/campaigns');
    
    await page.getByTestId('campaigns-new-brief').click();
    await expect(page.getByTestId('new-request-door')).toBeVisible();
    
    await page.screenshot({ path: 'test-results/screenshots/A2.png' });
  });

  test('A3 - choices lead to correct routes', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click();
    
    // Full campaign
    await page.keyboard.press('ControlOrMeta+p');
    await expect(page.getByTestId('new-request-door')).toBeVisible();
    await page.getByTestId('new-request-full-campaign').click();
    
    await expect(page).toHaveURL(/.*\/campaigns\/new/);
    
    // Single job
    await page.goto('/');
    await page.locator('body').click();
    await page.keyboard.press('ControlOrMeta+p');
    await expect(page.getByTestId('new-request-door')).toBeVisible();
    await page.getByTestId('new-request-single-job').click();
    await expect(page).toHaveURL(/.*\/campaigns\/new-job/);

    await page.screenshot({ path: 'test-results/screenshots/A3.png' });
  });

  test('A4 - internal work comes through the same door', async ({ page }) => {
    // Go into the single job flow and verify 'agency' can be selected as client
    await page.goto('/campaigns/new-job');
    await page.getByTestId('sj-client').selectOption({ label: 'Northwind Beverages' });
    
    await page.screenshot({ path: 'test-results/screenshots/A4.png' });
  });

  test.describe('A5 - non-manager sees permission notice', () => {
    // Use maker auth
    test.use({ storageState: authFile('maker') });
    
    test('non-manager sees permission notice', async ({ page }) => {
      await page.goto('/');
      await page.locator('body').click();
      await page.keyboard.press('ControlOrMeta+p');

      await expect(page.getByTestId('new-request-no-access')).toBeVisible();
      await expect(page.getByTestId('new-request-door')).not.toBeVisible();

      await page.screenshot({ path: 'test-results/screenshots/A5.png' });
    });
  });

  test('A6 - shortcut claimed even when focus is in a text field', async ({ page }) => {
    await page.goto('/campaigns');
    
    // Focus search input
    await page.getByTestId('campaigns-search').click();
    
    await page.keyboard.press('ControlOrMeta+p');

    await expect(page.getByTestId('new-request-door')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/A6.png' });
  });
});
