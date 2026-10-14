/**
 * Greedy "star" clustering: repeatedly take the badge with the most still-unassigned
 * neighbours and group it with them. Unlike connected components it never chains
 * (A~B, B~C does not put A and C together unless both are similar to the center).
 * The first member of each group is its center.
 */
export function starClusters(pairs: { a: number; b: number }[]): number[][] {
  const adj = new Map<number, Set<number>>();
  const link = (x: number, y: number) => {
    if (!adj.has(x)) adj.set(x, new Set());
    adj.get(x)!.add(y);
  };
  for (const { a, b } of pairs) {
    link(a, b);
    link(b, a);
  }

  const assigned = new Set<number>();
  const freeDegree = (n: number) => {
    let d = 0;
    for (const m of adj.get(n)!) if (!assigned.has(m)) d++;
    return d;
  };

  // Lazy max-heap of [degree, node]: stale entries are re-pushed with their current degree.
  const heap: [number, number][] = [];
  const higher = (i: number, j: number) => heap[i][0] > heap[j][0] || (heap[i][0] === heap[j][0] && heap[i][1] < heap[j][1]);
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!higher(i, p)) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && higher(l, m)) m = l;
        if (r < heap.length && higher(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  for (const [n, s] of adj) push([s.size, n]);
  const groups: number[][] = [];
  while (heap.length) {
    const [deg, center] = pop();
    if (assigned.has(center)) continue;
    const current = freeDegree(center);
    if (current === 0) continue;
    if (current < deg) {
      push([current, center]);
      continue;
    }
    const members = [...adj.get(center)!].filter((m) => !assigned.has(m)).sort((x, y) => x - y);
    assigned.add(center);
    for (const m of members) assigned.add(m);
    groups.push([center, ...members]);
  }
  return groups;
}
