export type Exclusive = <T>(operation: () => Promise<T>) => Promise<T>;

/** Serializes configuration, Portal and installation changes; failures do not poison the queue. */
export class MutationQueue {
  revision: Promise<void> = Promise.resolve();
  pending = 0;

  readonly run: Exclusive = operation => {
    this.pending++;
    const next = this.revision.then(operation).finally(() => { this.pending--; });
    this.revision = next.then(() => { }, () => { });
    return next;
  };
}
