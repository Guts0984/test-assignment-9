import type { QueryKey } from '@tanstack/react-query';
import type { AppEvent } from '@app/shared';
import { keys } from '@/shared/api/query-keys';

/** Which cached queries become stale when a server event arrives. Pure, so it is easy to test. */
export const keysToInvalidate = (event: AppEvent): QueryKey[] => {
  switch (event.type) {
    case 'item.changed':
      return [keys.order(event.orderId), keys.kitchen, keys.tables];
    case 'table.changed':
      return [keys.tables];
    case 'stoplist.changed':
    case 'menu.changed':
      // The menu changes, and so does every open check (drafts get flagged "unavailable").
      return [keys.menu, ['order']];
  }
};
