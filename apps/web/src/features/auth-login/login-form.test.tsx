import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './index';
import { apiError, id, mockFetch, renderApp } from '../../../test/utils';
import { navigation } from '../../../test/setup';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const me = (role: string) => ({ id: id(1), username: 'waiter1', displayName: 'Olena', role });

describe('LoginForm', () => {
  it('shows an error next to each empty field and does not call the server', async () => {
    const { fn } = mockFetch(() => me('waiter'));
    renderApp(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const user = screen.getByLabelText('Username');
    expect(user).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText('Enter your username')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    // linked to its field for screen readers
    expect(user.getAttribute('aria-describedby')).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });
  it('rejects a badly formed username before sending anything', async () => {
    const { fn } = mockFetch(() => me('waiter'));
    renderApp(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Username'), "a' OR 1=1");
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/3–32 letters/)).toBeInTheDocument();
    expect(fn).not.toHaveBeenCalled();
  });
  it('the whole path works from the keyboard: type, Tab, type, Enter → signed in and redirected by role', async () => {
    const { calls } = mockFetch(() => me('cook'));
    renderApp(<LoginForm />);
    const user = userEvent.setup();
    expect(screen.getByLabelText('Username')).toHaveFocus(); // autofocus lands on the first field
    await user.keyboard('cook1');
    await user.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    await user.keyboard('secret-pass{Enter}');
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/kitchen'));
    expect(calls[0]).toMatchObject({
      url: '/api/auth/login',
      method: 'POST',
      body: { username: 'cook1', password: 'secret-pass' },
    });
  });
  it.each([
    ['waiter', '/tables'],
    ['cook', '/kitchen'],
    ['manager', '/manager/menu'],
  ])('%s lands on %s', async (role, path) => {
    mockFetch(() => me(role));
    renderApp(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Username'), 'someone');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(path));
  });
  it('wrong credentials: a clear message, no redirect, the form stays usable', async () => {
    mockFetch(() => apiError(401, 'UNAUTHENTICATED'));
    renderApp(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Username'), 'waiter1');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('rate limited and offline have their own messages', async () => {
    mockFetch(() => apiError(429, 'RATE_LIMITED'));
    const first = renderApp(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Username'), 'waiter1');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
    first.unmount();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    renderApp(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Username'), 'waiter1');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
  });
  it('is fully translated: Ukrainian labels and messages', async () => {
    renderApp(<LoginForm />, { locale: 'uk' });
    expect(screen.getByLabelText('Логін')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(await screen.findByText('Введіть логін')).toBeInTheDocument();
    expect(screen.getByText('Введіть пароль')).toBeInTheDocument();
  });
});
