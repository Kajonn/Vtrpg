import { test, expect } from '@playwright/test';

const mockImage = { id: 'demo', url: 'https://placekitten.com/400/400', status: 'done' };

test.describe('drag-drop and zoom', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/rooms/*/images', (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({ status: 200, body: JSON.stringify([mockImage]) });
      }
      if (request.method() === 'POST') {
        return route.fulfill({ status: 200, body: JSON.stringify({ ...mockImage, id: 'upload' }) });
      }
      return route.fallback();
    });
  });

  test('game master uploads and zooms', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'alpha');
    await page.fill('input[placeholder="Display name"]', 'GM');
    await page.selectOption('select', 'gm');
    await page.click('button:has-text("Enter")');

    await expect(page.getByText('Släpp filer')).toBeVisible();

    const file = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      const file = new File(['hello'], 'greeting.txt', { type: 'text/plain' });
      data.items.add(file);
      return data;
    });

    const dropzone = page.locator('.dropzone');
    await dropzone.dispatchEvent('dragover');
    await dropzone.dispatchEvent('drop', { dataTransfer: file });

    await expect(page.getByText(/greeting.txt/)).toBeVisible();

    const canvas = page.locator('.canvas');
    await canvas.hover();
    await page.mouse.wheel(0, -400);
    const transform = await page.locator('.canvas-inner').evaluate((el) => el.style.transform);
    expect(transform).toContain('scale(');
  });
});
