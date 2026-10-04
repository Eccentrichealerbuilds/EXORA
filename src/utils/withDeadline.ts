/** A late result must never resume the caller's signing/submission sequence. */
export function withDeadline<T>(operation: Promise<T>, milliseconds: number, message: string,
  disposeLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(message));
    }, milliseconds);
    operation.then(value => {
      if (settled) { disposeLate?.(value); return; }
      settled = true; clearTimeout(timer); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(error);
    });
  });
}
