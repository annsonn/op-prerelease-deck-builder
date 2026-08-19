export const displayCardColorOrder = Object.freeze([
  'Red',
  'Blue',
  'Green',
  'Purple',
  'Yellow',
  'Black',
  'Unknown',
] as const)

export type DisplayCardColor = (typeof displayCardColorOrder)[number]

const recognizedColors = displayCardColorOrder.slice(0, -1)

export function normalizeDisplayCardColors(
  colors: readonly string[],
): readonly DisplayCardColor[] {
  const normalizedInputs = new Set(
    colors.map((color) => color.trim().toLowerCase()),
  )
  const normalized = recognizedColors.filter((color) =>
    normalizedInputs.has(color.toLowerCase()),
  )

  return Object.freeze(
    normalized.length === 0 ? ['Unknown'] : [...normalized],
  )
}
