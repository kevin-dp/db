import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection"

describe(`Collection Error Handling`, () => {
  let originalQueueMicrotask: typeof queueMicrotask
  let mockQueueMicrotask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Store original queueMicrotask
    originalQueueMicrotask = globalThis.queueMicrotask

    // Create mock that doesn't actually queue microtasks
    mockQueueMicrotask = vi.fn()
    globalThis.queueMicrotask = mockQueueMicrotask
  })

  afterEach(() => {
    // Restore original queueMicrotask
    globalThis.queueMicrotask = originalQueueMicrotask
    vi.clearAllMocks()
  })

  describe(`Cleanup Error Handling`, () => {
    it(`should complete cleanup successfully even when sync cleanup function throws an Error`, async () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `error-test-collection`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()

            // Return a cleanup function that throws an error
            return () => {
              throw new Error(`Sync cleanup failed`)
            }
          },
        },
      })

      // Start sync to get the cleanup function
      collection.preload()

      // Cleanup should complete successfully despite the error
      await expect(collection.cleanup()).resolves.toBeUndefined()

      // Collection should be in cleaned-up state
      expect(collection.status).toBe(`cleaned-up`)

      // Verify that a microtask was queued to re-throw the error
      expect(mockQueueMicrotask).toHaveBeenCalledTimes(1)

      // Get the microtask callback and verify it throws the expected error
      const microtaskCallback = mockQueueMicrotask.mock.calls[0]?.[0]
      expect(microtaskCallback).toBeDefined()
      expect(() => microtaskCallback()).toThrow(
        `Collection "error-test-collection" sync cleanup function threw an error: Sync cleanup failed`
      )
    })

    it(`should preserve original error stack trace when re-throwing in microtask`, async () => {
      const originalError = new Error(`Original sync error`)
      const originalStack = `original stack trace`
      originalError.stack = originalStack

      const collection = createCollection<{ id: string; name: string }>({
        id: `stack-trace-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()

            return () => {
              throw originalError
            }
          },
        },
      })

      // Start sync and cleanup
      collection.preload()
      await collection.cleanup()

      // Verify microtask was queued
      expect(mockQueueMicrotask).toHaveBeenCalledTimes(1)

      // Execute the microtask callback and catch the re-thrown error
      const microtaskCallback = mockQueueMicrotask.mock.calls[0]?.[0]
      expect(microtaskCallback).toBeDefined()

      let caughtError: Error | undefined
      try {
        microtaskCallback()
      } catch (error) {
        caughtError = error as Error
      }

      // Verify the re-thrown error has proper context and preserved stack
      expect(caughtError).toBeDefined()
      expect(caughtError!.message).toBe(
        `Collection "stack-trace-test" sync cleanup function threw an error: Original sync error`
      )
      expect(caughtError!.stack).toBe(originalStack) // Original stack preserved
      expect(caughtError!.cause).toBe(originalError) // Original error chained
    })

    it(`should handle non-Error thrown values in sync cleanup`, async () => {
      const nonErrorValue = `String error message`

      const collection = createCollection<{ id: string; name: string }>({
        id: `non-error-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()

            return () => {
              throw nonErrorValue
            }
          },
        },
      })

      // Start sync and cleanup
      collection.preload()
      await collection.cleanup()

      // Verify microtask was queued
      expect(mockQueueMicrotask).toHaveBeenCalledTimes(1)

      // Execute the microtask callback and catch the re-thrown error
      const microtaskCallback = mockQueueMicrotask.mock.calls[0]?.[0]
      expect(microtaskCallback).toBeDefined()

      let caughtError: Error | undefined
      try {
        microtaskCallback()
      } catch (error) {
        caughtError = error as Error
      }

      // Verify non-Error values are handled properly
      expect(caughtError).toBeDefined()
      expect(caughtError!.message).toBe(
        `Collection "non-error-test" sync cleanup function threw an error: String error message`
      )

      // No cause or stack preservation for non-Error values
      expect(caughtError!.cause).toBeUndefined()
    })

    it(`should not interfere with cleanup when sync cleanup function is undefined`, async () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `no-cleanup-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()
            // No cleanup function returned
          },
        },
      })

      // Start sync
      collection.preload()

      // Cleanup should work normally without any cleanup function
      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(collection.status).toBe(`cleaned-up`)

      // No microtask should be queued when there's no cleanup function
      expect(mockQueueMicrotask).not.toHaveBeenCalled()
    })

    it(`should handle multiple cleanup calls gracefully`, async () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `multiple-cleanup-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()

            return () => {
              throw new Error(`Cleanup error`)
            }
          },
        },
      })

      // Start sync
      collection.preload()

      // First cleanup should complete successfully despite error
      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(collection.status).toBe(`cleaned-up`)

      // Second cleanup should also complete successfully (idempotent)
      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(collection.status).toBe(`cleaned-up`)

      // Third cleanup should also work (proving idempotency)
      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(collection.status).toBe(`cleaned-up`)

      // Verify that microtasks were queued for cleanup attempts
      // (Each cleanup call that encounters a cleanup function will queue a microtask)
      expect(mockQueueMicrotask).toHaveBeenCalled()

      // All queued microtasks should throw the expected error when executed
      for (const call of mockQueueMicrotask.mock.calls) {
        const microtaskCallback = call[0]
        expect(microtaskCallback).toBeDefined()
        expect(() => microtaskCallback()).toThrow(
          `Collection "multiple-cleanup-test" sync cleanup function threw an error: Cleanup error`
        )
      }
    })
  })

  describe(`Operation Validation Errors`, () => {
    it(`should throw helpful errors when trying to use operations on error status collection`, async () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `error-status-test`,
        getKey: (item) => item.id,
        sync: {
          sync: () => {
            throw new Error(`Sync initialization failed`)
          },
        },
      })

      // Try to start sync, which should put collection in error state
      try {
        await collection.preload()
      } catch {
        // Expected to throw
      }
      expect(collection.status).toBe(`error`)

      // Now operations should be blocked with helpful messages
      expect(() => {
        collection.insert({ id: `1`, name: `test` })
      }).toThrow(
        `Cannot perform insert on collection "error-status-test" - collection is in error state. Try calling cleanup() and restarting the collection.`
      )

      expect(() => {
        collection.update(`1`, (draft) => {
          draft.name = `updated`
        })
      }).toThrow(
        `Cannot perform update on collection "error-status-test" - collection is in error state. Try calling cleanup() and restarting the collection.`
      )

      expect(() => {
        collection.delete(`1`)
      }).toThrow(
        `Cannot perform delete on collection "error-status-test" - collection is in error state. Try calling cleanup() and restarting the collection.`
      )
    })

    it(`should throw helpful errors when trying to use operations on cleaned-up collection`, async () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `cleaned-up-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()
          },
        },
      })

      // Clean up the collection
      await collection.cleanup()
      expect(collection.status).toBe(`cleaned-up`)

      // Operations should be blocked with helpful messages
      expect(() => {
        collection.insert({ id: `1`, name: `test` })
      }).toThrow(
        `Cannot perform insert on collection "cleaned-up-test" - collection has been cleaned up. The collection will automatically restart on next access.`
      )

      expect(() => {
        collection.update(`1`, (draft) => {
          draft.name = `updated`
        })
      }).toThrow(
        `Cannot perform update on collection "cleaned-up-test" - collection has been cleaned up. The collection will automatically restart on next access.`
      )

      expect(() => {
        collection.delete(`1`)
      }).toThrow(
        `Cannot perform delete on collection "cleaned-up-test" - collection has been cleaned up. The collection will automatically restart on next access.`
      )
    })
  })

  describe(`State Transition Validation`, () => {
    it(`should prevent invalid state transitions`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `transition-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()
          },
        },
      })

      // Access private method for testing (using any cast)
      const collectionImpl = collection as any

      expect(collection.status).toBe(`idle`)

      // Test invalid transition
      expect(() => {
        collectionImpl.validateStatusTransition(`ready`, `loading`)
      }).toThrow(
        `Invalid collection status transition from "ready" to "loading" for collection "transition-test"`
      )

      // Test valid transition
      expect(() => {
        collectionImpl.validateStatusTransition(`idle`, `loading`)
      }).not.toThrow()
    })

    it(`should allow all valid state transitions`, () => {
      const collection = createCollection<{ id: string; name: string }>({
        id: `valid-transitions-test`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, commit }) => {
            begin()
            commit()
          },
        },
      })

      const collectionImpl = collection as any

      // Valid transitions from idle
      expect(() =>
        collectionImpl.validateStatusTransition(`idle`, `loading`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`idle`, `error`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`idle`, `cleaned-up`)
      ).not.toThrow()

      // Valid transitions from loading
      expect(() =>
        collectionImpl.validateStatusTransition(`loading`, `initialCommit`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`loading`, `error`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`loading`, `cleaned-up`)
      ).not.toThrow()

      // Valid transitions from initialCommit
      expect(() =>
        collectionImpl.validateStatusTransition(`initialCommit`, `ready`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`initialCommit`, `error`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`initialCommit`, `cleaned-up`)
      ).not.toThrow()

      // Valid transitions from ready
      expect(() =>
        collectionImpl.validateStatusTransition(`ready`, `cleaned-up`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`ready`, `error`)
      ).not.toThrow()

      // Valid transitions from error (allow recovery)
      expect(() =>
        collectionImpl.validateStatusTransition(`error`, `cleaned-up`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`error`, `idle`)
      ).not.toThrow()

      // Valid transitions from cleaned-up (allow restart)
      expect(() =>
        collectionImpl.validateStatusTransition(`cleaned-up`, `loading`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`cleaned-up`, `error`)
      ).not.toThrow()

      // Allow same-state transitions (idempotent operations)
      expect(() =>
        collectionImpl.validateStatusTransition(`idle`, `idle`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(
          `initialCommit`,
          `initialCommit`
        )
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`ready`, `ready`)
      ).not.toThrow()
      expect(() =>
        collectionImpl.validateStatusTransition(`cleaned-up`, `cleaned-up`)
      ).not.toThrow()
    })
  })
})
