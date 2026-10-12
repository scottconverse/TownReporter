/*
  THT-8: a status write that has not answered yet, per lead. A restore (U) pressed
  right behind a slow kill must wait for that kill to land, or the restore finds
  nothing killed and the kill lands after it -- the undo is lost.
*/
export function createLeadWrites() {
  const writes = new Map<number, Promise<unknown>>();
  return {
    /** Remember `write` as the lead's pending write until it settles. */
    track<T>(id: number, write: Promise<T>): Promise<T> {
      writes.set(id, write);
      const clear = () => {
        if (writes.get(id) === write) writes.delete(id);
      };
      void write.then(clear, clear);
      return write;
    },
    /** Resolves once the lead's pending write (if any) has answered, failed or not. */
    async settled(id: number): Promise<void> {
      const earlier = writes.get(id);
      if (earlier) await earlier.catch(() => undefined);
    },
  };
}
