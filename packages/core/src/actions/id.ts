import { ActionId } from './schema.ts';

const hex = (byte: number) => byte.toString(16).padStart(2, '0');

/**
 * Generates a UUIDv7 string: a 48-bit millisecond timestamp followed by random bits.
 * Log position, not the ID, orders actions, so IDs need not be monotonic within a millisecond.
 */
export const uuidv7 = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const timestamp = Date.now();
  for (let index = 0; index < 6; index++) {
    bytes[index] = Math.floor(timestamp / 2 ** (8 * (5 - index))) % 256;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const digits = Array.from(bytes, hex).join('');
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
};

/** A fresh action ID, used by Core for parsed model actions and by the Harness for everything else. */
export const makeActionId = (): ActionId => ActionId.make(uuidv7());
