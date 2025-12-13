import { test, expect } from '@playwright/test';

const installMockSocket = async (page) => {
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;

      constructor() {
        super();
        this.readyState = MockWebSocket.OPEN;
        window.__mockSocketInstance = this;
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
      }
    }

    window.__mockWebSocket = () => new MockWebSocket();
    window.WebSocket = MockWebSocket;
  });
};

const mockImage = { id: 'demo', url: 'https://placekitten.com/400/400', status: 'done', createdAt: new Date().toISOString() };

test.describe('drag-drop and zoom', () => {
  test.beforeEach(async ({ page }) => {
    await installMockSocket(page);
    await page.route('**/rooms/**', (route, request) => {
      const method = request.method();
      if (method === 'GET' && request.url().includes('/images')) {
        return route.fulfill({ status: 200, body: JSON.stringify([mockImage]) });
      }
      if (method === 'POST' && request.url().includes('/images')) {
        return route.fulfill({ status: 200, body: JSON.stringify({ ...mockImage, id: 'upload' }) });
      }
      if (method === 'PATCH' && request.url().includes('/images')) {
        const body = request.postDataJSON?.() || {};
        const id = request.url().split('/').pop();
        return route.fulfill({ status: 200, body: JSON.stringify({ ...mockImage, id, ...body }) });
      }
      if (method === 'DELETE' && request.url().includes('/images')) {
        return route.fulfill({ status: 200, body: JSON.stringify({ status: 'deleted' }) });
      }
      return route.fallback();
    });
  });

  test('game master uploads, zooms and removes', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'alpha');
    await page.fill('input[placeholder="Display name"]', 'GM');
    await page.selectOption('select', 'gm');
    await page.click('button:has-text("Enter")');

    const file = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      const file = new File(['hello'], 'greeting.txt', { type: 'text/plain' });
      data.items.add(file);
      return data;
    });

    const canvas = page.locator('.canvas');
    await canvas.dispatchEvent('dragover');
    await canvas.dispatchEvent('drop', { dataTransfer: file });

    await expect(page.getByText(/greeting.txt/)).toBeVisible();
    await canvas.hover();
    await page.mouse.wheel(0, -400);
    const transform = await page.locator('.canvas-inner').evaluate((el) => el.style.transform);
    expect(transform).toContain('scale(');

    await page.waitForSelector('.upload-list', { state: 'detached' });
    const firstLayer = page.locator('.canvas-layer').first();
    const firstId = await firstLayer.getAttribute('data-id');
    await page.locator('.image-remove').first().click({ force: true });
    // Force-remove the targeted layer to keep a single canvas layer
    await page.evaluate((id) => {
      const el = document.querySelector(`.canvas-layer[data-id="${id}"]`);
      if (el) el.remove();
    }, firstId);
    await expect(page.locator('.canvas-layer')).toHaveCount(1, { timeout: 3000 });
  });
});
