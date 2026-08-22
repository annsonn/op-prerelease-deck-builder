import {
  type PlayableCard,
  type SerializedCardFeatures,
} from '../../shared/catalog.js'
import {
  classifyCardFeatures,
  type CardFeatures,
} from '../../shared/card-features.js'
import { CURRENT_EFFECT_PARSER_REVISION } from '../../shared/card-effect-model.js'
import { cloneAndDeepFreeze } from '../../shared/clone-and-deep-freeze.js'

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    )
  }
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        structurallyEqual(leftRecord[key], rightRecord[key]),
    )
  )
}

export function upgradeSerializedCardFeatures(
  card: PlayableCard,
  serialized: SerializedCardFeatures | undefined,
): CardFeatures {
  const projected = classifyCardFeatures(card)

  if (
    serialized !== undefined &&
    'effectModelVersion' in serialized &&
    serialized.effectModelVersion === 2 &&
    serialized.effectParserRevision === CURRENT_EFFECT_PARSER_REVISION &&
    structurallyEqual(serialized.effects, projected.effects) &&
    structurallyEqual(serialized.unparsedClauses, projected.unparsedClauses)
  ) {
    return cloneAndDeepFreeze({
      ...projected,
      effectModelVersion: serialized.effectModelVersion,
      effectParserRevision: serialized.effectParserRevision,
      effects: serialized.effects,
      unparsedClauses: serialized.unparsedClauses,
    })
  }

  return cloneAndDeepFreeze(projected)
}
