import { describe, expect, it } from "vitest"
import type { TransactionConfig } from "../src/types"

describe(`Transaction Types`, () => {
  it(`should validate TransactionConfig structure`, () => {
    // Full config
    const fullConfig: TransactionConfig = {
      id: `custom-transaction-id`,
      metadata: { source: `user-form` },
      mutationFn: async () => {},
    }

    expect(fullConfig.id).toBe(`custom-transaction-id`)
    expect(fullConfig.metadata).toEqual({ source: `user-form` })
  })
})
