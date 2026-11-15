import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks these; Radix dialogs and layout code touch them.
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', function ResizeObserverStub() {
    return { observe() {}, unobserve() {}, disconnect() {} };
  });
}
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

// Locale-aware navigation needs the Next.js runtime; in unit tests it is a thin stand-in.
export const navigation = { replace: vi.fn(), push: vi.fn() };
vi.mock('@/shared/i18n/navigation', () => ({
  useRouter: () => navigation,
  usePathname: () => '/tables',
  getPathname: () => '/',
  redirect: () => undefined,
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));
