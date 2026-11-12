import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { routes } from './routes';

// jsdom has no WebGL; the landing page's scene is covered in LandingPage.test.tsx.
vi.mock('../scene/LabScene', () => ({ default: () => null }));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('app shell', () => {
  it('navigates from the landing page to the morgue and focuses the content', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Reanimation lab' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Enter the morgue' }));

    expect(router.state.location.pathname).toBe('/morgue');
    expect(screen.getByRole('heading', { level: 1, name: 'The morgue' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('leaves focus alone on the initial load under StrictMode, so the first Tab reaches the skip link', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/morgue'] });
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );

    expect(screen.getByRole('main')).not.toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it('keeps one lab scene layer mounted across routes, behind the content', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const layer = screen.getByTestId('lab-scene-layer');
    await user.click(screen.getByRole('link', { name: 'Enter the morgue' }));
    expect(screen.getByRole('heading', { level: 1, name: 'The morgue' })).toBeInTheDocument();
    expect(screen.getAllByTestId('lab-scene-layer')).toEqual([layer]);
    await user.click(screen.getByRole('link', { name: 'Lazarus' }));
    expect(screen.getByTestId('lab-scene-layer')).toBe(layer);
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveAttribute('inert');
  });

  it('shows a not-found page for unknown paths', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing buried here' })).toBeInTheDocument();
  });
});
