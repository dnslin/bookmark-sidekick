export function clearSavedEdits<T extends object>(current: Partial<T>, saved: Partial<T>): Partial<T> {
  const next = { ...current };
  for (const key of Object.keys(saved) as (keyof T)[]) {
    if (Object.is(current[key], saved[key])) delete next[key];
  }
  return next;
}
