import { test, expect } from '@playwright/test';

const mockImage = { id: 'demo', url: 'https://placekitten.com/400/400', status: 'done', createdAt: new Date().toISOString() };

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

      send(data) {
        window.__lastSent = JSON.parse(data);
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
      }

      simulateMessage(payload) {
        const event = new MessageEvent('message', { data: JSON.stringify(payload) });
        this.dispatchEvent(event);
      }
    }

    window.__mockWebSocket = () => new MockWebSocket();
    window.WebSocket = MockWebSocket;
  });
};

const enterRoom = async (page) => {
  await page.route('**/rooms/**', (route, request) => {
    const method = request.method();
    if (method === 'GET' && request.url().includes('/images')) {
      return route.fulfill({ status: 200, body: JSON.stringify([mockImage]) });
    }
    return route.fallback();
  });

  await installMockSocket(page);

  await page.goto('/');
  await page.fill('input[placeholder="Room"]', 'alpha');
  await page.fill('input[placeholder="Display name"]', 'Player');
  await page.selectOption('select', 'player');
  await page.click('button:has-text("Enter")');
};

test.describe('dice synchronization', () => {
  test('sends dice roll requests with current count', async ({ page }) => {
    await enterRoom(page);

    await expect(page.getByText('4 dice')).toBeVisible();
    await page.getByRole('button', { name: 'Roll dice' }).click();

    const lastSent = await page.evaluate(() => window.__lastSent);
    expect(lastSent).toEqual({ type: 'DiceRollRequest', payload: { count: 4 } });
  });

  test('applies broadcast seed and count consistently', async ({ page }) => {
    await enterRoom(page);

    const canvas = page.locator('.dice-overlay');
    const beforeRollId = await canvas.getAttribute('data-roll-id');

    await page.evaluate(() => {
      window.__mockSocketInstance.simulateMessage({ type: 'DiceRoll', payload: { count: 9, seed: 12345 } });
    });

    await expect(page.getByText('9 dice')).toBeVisible();
    await expect(canvas).toHaveAttribute('data-seed', '12345');
    await expect(canvas).not.toHaveAttribute('data-roll-id', beforeRollId || '0');
  });
});
