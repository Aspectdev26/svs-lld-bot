/**
 * Global serialization queue for League-Manager approve/deny actions across every admin
 * approval flow (signups, vacation/extended-vacation requests, dodge requests, ...). Each of
 * these follows the same shape: read a Pending row, do some async work, then write back
 * Approved/Denied. Two clicks on the same row within that window — two managers both hitting
 * Approve, or one Approve racing one Deny — can both pass the "still Pending" read before either
 * write lands (this is exactly how a signup request got double-approved onto the ladder).
 *
 * Queue every resolution through here, and re-read the row's live status from inside the
 * callback right before acting, so whichever click runs second always sees the first one's
 * outcome and can bail out instead of repeating the work. One shared queue across all these
 * flows is fine — League Manager approvals are rare enough that cross-flow serialization costs
 * nothing observable.
 */
let queue: Promise<unknown> = Promise.resolve();

export function enqueueResolution<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
