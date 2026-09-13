const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Stable IDs reserved for the demo fixtures. */
export function fixedId(sequence: number): string {
  let tail = '';
  let value = sequence;
  for (let index = 0; index < 16; index++) {
    tail = alphabet[value % 32]! + tail;
    value = Math.floor(value / 32);
  }
  return `01K4K00000${tail}`;
}
