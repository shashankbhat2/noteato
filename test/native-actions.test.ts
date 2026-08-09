import { describe, expect, it } from 'vitest'
import {
  NATIVE_ACTIONS,
  NATIVE_ACTION_CATEGORIES,
  nativeActionDefinition
} from '../src/shared/nativeActions'

describe('native action catalog', () => {
  it('keeps stable unique actions grouped in the declared category order', () => {
    expect(new Set(NATIVE_ACTIONS.map((action) => action.id)).size).toBe(NATIVE_ACTIONS.length)
    expect(new Set(NATIVE_ACTIONS.map((action) => action.category))).toEqual(
      new Set(NATIVE_ACTION_CATEGORIES)
    )
    expect(nativeActionDefinition('draft-email')?.label).toBe('Draft email')
  })

  it('never tells the model to perform an external side effect', () => {
    for (const action of NATIVE_ACTIONS) {
      expect(action.system).toContain('do not claim to have sent, scheduled, or changed anything')
    }
  })
})
