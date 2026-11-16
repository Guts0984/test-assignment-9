import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './index';
import { apiError, id, mockFetch, renderApp } from '../../../test/utils';
import { navigation } from '../../../test/setup';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const ME = { id: id(2), username: 'waiter1', displayName: 'Olena', role: 'waiter' };

describe('AppShell and the session', () => {
  it('signed in: the header and the page', async () => {
    mockFetch(() => ME);
    renderApp(
      <AppShell roles={['waiter']}>
        <p>page</p>
      </AppShell>,
    );
    expect(await screen.findByText('page')).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('401 on /me → the login page', async () => {
    mockFetch(() => apiError(401, 'UNAUTHENTICATED'));
    renderApp(
      <AppShell roles={['waiter']}>
        <p>page</p>
      </AppShell>,
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('page')).not.toBeInTheDocument();
  });

  it('a failed /me (server restarting) does NOT sign the user out: an error with "Try again", no redirect', async () => {
    let up = false;
    mockFetch(() => (up ? ME : apiError(503, 'INTERNAL')));
    renderApp(
      <AppShell roles={['waiter']}>
        <p>page</p>
      </AppShell>,
    );
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('page')).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('any call answered with 401 later (session expired meanwhile) sends the user to the login page', async () => {
    mockFetch(() => ME);
    const view = renderApp(
      <AppShell roles={['waiter']}>
        <p>page</p>
      </AppShell>,
    );
    await screen.findByText('page');
    // some screen's query is refused with 401
    await view.client
      .fetchQuery({
        queryKey: ['tables'],
        queryFn: () =>
          Promise.reject(
            Object.assign(new Error('x'), {
              name: 'ApiError',
              status: 401,
              code: 'UNAUTHENTICATED',
              details: [],
            }),
          ),
        retry: false,
      })
      .catch(() => undefined);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
  });

  it('the wrong role is sent to its own home', async () => {
    mockFetch(() => ({ ...ME, role: 'cook' }));
    renderApp(
      <AppShell roles={['waiter']}>
        <p>page</p>
      </AppShell>,
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/kitchen'));
  });
});
