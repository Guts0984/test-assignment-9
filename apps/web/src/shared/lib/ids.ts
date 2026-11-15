/** A fresh UUID (v4). Used for client-generated payment ids (idempotency keys). */
export const newId = (): string => globalThis.crypto.randomUUID();
