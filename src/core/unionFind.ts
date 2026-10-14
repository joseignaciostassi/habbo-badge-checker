/** Connected components over integer ids. */
export class UnionFind {
  private parent = new Map<number, number>();

  find(x: number): number {
    let root = x;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    if (!this.parent.has(x)) this.parent.set(x, x);
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }

  /** Components with 2+ members, largest first. */
  groups(): number[][] {
    const by = new Map<number, number[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      if (!by.has(r)) by.set(r, []);
      by.get(r)!.push(x);
    }
    return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a - b)).sort((a, b) => b.length - a.length || a[0] - b[0]);
  }
}
