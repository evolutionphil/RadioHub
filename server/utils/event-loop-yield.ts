export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function processInChunks<T>(
  items: T[],
  chunkSize: number,
  processor: (item: T, index: number) => Promise<void>,
  delayBetweenChunks: number = 50
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await processor(items[i], i);
    if ((i + 1) % chunkSize === 0 && i + 1 < items.length) {
      await sleep(delayBetweenChunks);
    }
  }
}
