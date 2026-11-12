import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';

// The scene chunk stays pending until the test releases it, as a slow network would.
const chunk = vi.hoisted(() => {
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { loaded, release, requested: false };
});

vi.mock('../../scene/LabScene', async () => {
  chunk.requested = true;
  await chunk.loaded;
  return { default: () => <div data-testid="lab-scene" /> };
});

// jsdom has no WebGL; without this the slot would show the still (Requirement 7.4).
vi.mock('../../scene/webgl', () => ({ hasWebGL: () => true }));

function renderLanding() {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('landing page', () => {
  it('is interactive before the scene chunk has loaded', async () => {
    const user = userEvent.setup();
    const router = renderLanding();
    expect(screen.getByRole('heading', { level: 1, name: 'Reanimation lab' })).toBeInTheDocument();
    // The chunk is requested after first paint and idle, and is still loading.
    await waitFor(() => expect(chunk.requested).toBe(true));
    expect(screen.queryByTestId('lab-scene')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Enter the morgue' }));
    expect(router.state.location.pathname).toBe('/morgue');
  });

  it('mounts the scene once its chunk loads, hidden from assistive tech', async () => {
    chunk.release();
    renderLanding();
    const scene = await screen.findByTestId('lab-scene');
    const slot = scene.closest('[aria-hidden="true"]');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('inert');
    // The link stays the only interactive content.
    expect(screen.getByRole('link', { name: 'Enter the morgue' })).toBeInTheDocument();
  });
});
