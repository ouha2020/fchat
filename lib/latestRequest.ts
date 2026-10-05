/** Discard results from superseded reads without changing the RPC contract. */
export function createLatestRequestGate() {
  let generation = 0;
  return {
    begin(): () => boolean {
      const requestGeneration = ++generation;
      return () => requestGeneration === generation;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}
