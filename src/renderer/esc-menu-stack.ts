type DismissFn = () => void;

const stack: DismissFn[] = [];

export function registerMenuDismiss(dismissFn: DismissFn): () => void {
  stack.push(dismissFn);
  return () => {
    const idx = stack.indexOf(dismissFn);
    if (idx !== -1) stack.splice(idx, 1);
  };
}

export function dismissTopMenu(): boolean {
  const fn = stack.pop();
  if (!fn) return false;
  try { fn(); } catch { /* never jam the stack */ }
  return true;
}

export function hasOpenMenus(): boolean {
  return stack.length > 0;
}
