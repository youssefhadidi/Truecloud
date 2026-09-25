/** @format */

import { useCallback, useInsertionEffect, useRef, useState } from 'react';

// Handlers with a fixed identity that always run the latest closure. Passing
// them to memo'd children (the virtualized grid/list cells) keeps those from
// re-rendering on every parent render, without the handlers reading stale state.
//
// Only for event handlers and effects: the ref is refreshed after render, so a
// call made *during* render would see the previous render's closure.

export function useStableCallback(fn) {
  const ref = useRef(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current(...args), []);
}

/** Same, for an object of handlers. The set of keys must not change between renders. */
export function useStableCallbacks(fns) {
  const ref = useRef(fns);
  useInsertionEffect(() => {
    ref.current = fns;
  });
  const [stable] = useState(() => {
    const wrappers = {};
    for (const key of Object.keys(fns)) {
      wrappers[key] = (...args) => ref.current[key](...args);
    }
    return wrappers;
  });
  return stable;
}
