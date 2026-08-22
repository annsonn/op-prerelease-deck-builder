export function cloneAndDeepFreeze<T>(value: T): T {
  const clone = structuredClone(value)

  function freezeRecursively(candidate: unknown): void {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Object.isFrozen(candidate)
    ) {
      return
    }

    for (const child of Object.values(candidate)) freezeRecursively(child)
    Object.freeze(candidate)
  }

  freezeRecursively(clone)
  return clone
}
