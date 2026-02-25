//
// This hook keeps a ref in sync with the latest value so imperative callbacks
// (like CodeMirror listeners or async flows) always see the current value
// without forcing listener teardown/re-subscribe churn on every render.
//
import { useRef } from 'react';

export const useLatestRef = <T>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};
