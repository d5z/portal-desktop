/** Ordered message bounds let scroll handlers locate a boundary with logarithmic layout reads. */
export function firstAfter(length: number, boundary: number, position: (index: number) => number) {
  let low = 0, high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (position(middle) <= boundary) low = middle + 1;
    else high = middle;
  }
  return low;
}
