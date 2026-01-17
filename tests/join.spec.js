import { test, expect } from '@playwright/test';

const roomSlug = 'join-me';

test.describe('join page', () => {
  test('allows entering a name and joins the room', async ({ page }) => {
    await page.route('**/rooms/slug/**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ id: 'room-1', slug: roomSlug, name: 'Joinable room' }),
      });
    });

    await page.route('**/rooms/join', (route, request) => {
      const body = request.postDataJSON?.() || {};
      expect(body).toMatchObject({ slug: roomSlug, role: 'player' });
      expect(body.name).toBe('Adventurer');
      route.fulfill({
        status: 201,
        body: JSON.stringify({
          roomId: 'room-1',
          roomSlug,
          player: { id: 'player-1', name: body.name, token: 'token-1', role: 'player' },
        }),
      });
    });

    await page.goto(`/room/${roomSlug}`);
    const nameInput = page.getByLabel('Your name');
    await nameInput.fill('  Adventurer  ');
    await expect(nameInput).toHaveValue('  Adventurer  ');

    await page.getByRole('button', { name: 'Join room' }).click();
    await page.waitForURL(`**/rooms/${roomSlug}`);
    expect(page.url()).toContain(`/rooms/${roomSlug}`);
  });

  test('shows an error when the room cannot be found', async ({ page }) => {
    await page.route('**/rooms/slug/**', (route) => {
      route.fulfill({
        status: 404,
        body: JSON.stringify({ error: 'room not found' }),
      });
    });

    await page.goto(`/room/${roomSlug}`);

    await expect(page.getByText('Room not found.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  test('shows join errors returned by the server', async ({ page }) => {
    await page.route('**/rooms/slug/**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ id: 'room-2', slug: roomSlug, name: 'Joinable room' }),
      });
    });

    await page.route('**/rooms/join', (route) => {
      route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'room full' }),
      });
    });

    await page.goto(`/room/${roomSlug}`);
    await page.getByLabel('Your name').fill('Player');
    await page.getByRole('button', { name: 'Join room' }).click();

    await expect(page.getByText('room full')).toBeVisible();
    expect(page.url()).toContain(`/room/${roomSlug}`);
  });
});
