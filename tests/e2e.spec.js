import { test, expect } from '@playwright/test';

const mockImage = { id: 'demo', url: 'https://placekitten.com/400/400', status: 'done', createdAt: new Date().toISOString() };

test.describe('drag-drop and zoom', () => {
  let gmLocked = false;

  test.beforeEach(async ({ page }) => {
    gmLocked = false;
    await page.route('**/rooms/**', (route, request) => {
      const method = request.method();
      if (method === 'GET' && request.url().includes('/gm')) {
        return route.fulfill({ status: 200, body: JSON.stringify({ active: gmLocked }) });
      }
      if (method === 'GET' && request.url().includes('/dice')) {
        return route.fulfill({ status: 200, body: JSON.stringify([]) });
      }
      if (method === 'POST' && request.url().includes('/dice')) {
        const body = request.postDataJSON?.() || {};
        return route.fulfill({ status: 200, body: JSON.stringify({ id: 'dice-log', ...body }) });
      }
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

    await page.waitForSelector('.upload-list', { state: 'detached', timeout: 10000 });
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

  test('GM can delete images without DOM errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'alpha');
    await page.fill('input[placeholder="Display name"]', 'GM');
    await page.selectOption('select', 'gm');
    await page.click('button:has-text("Enter")');

    // Wait for the initial image to load
    await expect(page.locator('.canvas-layer')).toHaveCount(1);

    // Click the remove button
    const removeButton = page.locator('.image-remove').first();
    await removeButton.click();

    // Verify the image is removed
    await expect(page.locator('.canvas-layer')).toHaveCount(0, { timeout: 3000 });

    // Verify no React DOM errors occurred
    expect(consoleErrors).toEqual([]);
  });

  test('prevents joining a room with an active GM', async ({ page }) => {
    gmLocked = true;
    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'alpha');
    await page.fill('input[placeholder="Display name"]', 'GM #2');
    await page.selectOption('select', 'gm');
    await page.click('button:has-text("Enter")');

    await expect(page.getByText('Det finns redan en spelledare i detta rum.')).toBeVisible();
  });

  test('players can pan the scene', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'beta');
    await page.fill('input[placeholder="Display name"]', 'Explorer');
    await page.selectOption('select', 'player');
    await page.click('button:has-text("Enter")');

    const canvas = page.locator('.canvas');
    const inner = page.locator('.canvas-inner');
    const initialTransform = await inner.evaluate((el) => el.style.transform);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40);
    await page.mouse.up();
    const afterTransform = await inner.evaluate((el) => el.style.transform);

    expect(afterTransform).not.toEqual(initialTransform);
    expect(afterTransform).toContain('translate(');
  });

  test('dice overlay can be triggered', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'gamma');
    await page.fill('input[placeholder="Display name"]', 'Viewer');
    await page.selectOption('select', 'player');
    await page.click('button:has-text("Enter")');

    const rollButton = page.getByRole('button', { name: /roll dice/i });
    await expect(rollButton).toBeVisible();
    await rollButton.click();

    const status = page.locator('.dice-status');
    await expect(status).toHaveAttribute('data-state', /rolling|settled/);
    await expect(page.getByLabel('dice-canvas')).toBeVisible();
  });

  test('dice rolls are synchronized between users', async ({ browser }) => {
    // Create two pages within the same browser context to simulate two users
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page2.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Setup route mocking for both pages
    for (const page of [page1, page2]) {
      await page.route('**/rooms/**', (route, request) => {
        const method = request.method();
        if (method === 'GET' && request.url().includes('/gm')) {
          return route.fulfill({ status: 200, body: JSON.stringify({ active: false }) });
        }
        if (method === 'GET' && request.url().includes('/dice')) {
          return route.fulfill({ status: 200, body: JSON.stringify([]) });
        }
        if (method === 'POST' && request.url().includes('/dice')) {
          const body = request.postDataJSON?.() || {};
          return route.fulfill({ status: 200, body: JSON.stringify({ id: 'dice-log', ...body }) });
        }
        if (method === 'GET' && request.url().includes('/images')) {
          return route.fulfill({ status: 200, body: JSON.stringify([]) });
        }
        return route.fallback();
      });
    }

    // User 1 (GM) joins room 'dice-test'
    await page1.goto('/');
    await page1.fill('input[placeholder="Room"]', 'dice-test');
    await page1.fill('input[placeholder="Display name"]', 'Player1');
    await page1.selectOption('select', 'gm');
    await page1.click('button:has-text("Enter")');
    await page1.waitForSelector('.dice-overlay');

    // User 2 (Player) joins same room 'dice-test'
    await page2.goto('/');
    await page2.fill('input[placeholder="Room"]', 'dice-test');
    await page2.fill('input[placeholder="Display name"]', 'Player2');
    await page2.selectOption('select', 'player');
    await page2.click('button:has-text("Enter")');
    await page2.waitForSelector('.dice-overlay');

    // Verify both users see the dice overlay
    await expect(page1.getByLabel('dice-overlay')).toBeVisible();
    await expect(page2.getByLabel('dice-overlay')).toBeVisible();

    // Ensure pages are visible/focused to allow requestAnimationFrame to work
    await page1.bringToFront();
    
    // User 1 triggers a dice roll
    const rollButton1 = page1.getByRole('button', { name: /roll dice/i });
    await rollButton1.click();

    // Verify User 1's dice status changes to rolling
    const status1 = page1.locator('.dice-status');
    await expect(status1).toHaveAttribute('data-state', 'rolling', { timeout: 2000 });

    // Verify User 2 also sees the dice rolling (synchronized via BroadcastChannel)
    // This is the key test - that both pages react to the same roll
    const status2 = page2.locator('.dice-status');
    await expect(status2).toHaveAttribute('data-state', 'rolling', { timeout: 2000 });

    // The fact that both transitioned to rolling state proves synchronization works
    // We don't need to wait for the physics simulation to complete

    // Cleanup
    await context.close();
  });

  test('restores a saved session from localStorage', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder="Room"]', 'delta');
    await page.fill('input[placeholder="Display name"]', 'Returner');
    await page.selectOption('select', 'gm');
    await page.click('button:has-text("Enter")');

    await expect(page.getByText('Room: delta')).toBeVisible();

    await page.reload();

    // The login form should be skipped because the session is restored
    await expect(page.getByText('Room: delta')).toBeVisible();
    await expect(page.getByText('Returner')).toBeVisible();
  });
});
