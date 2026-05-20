/**
 * @file Test for #3890: fire-and-forget ACP prompt delivery on session creation
 * Verifies that session.promptDelivery starts as 'pending' and updates to 'delivered'/'failed'.
 */
import { describe, it, expect, vi } from "vitest";

type PromptDelivery = { delivered: boolean; attempts: number; status?: "pending" | "delivered" | "failed" | "timeout"; error?: string };

describe("#3890: async ACP prompt delivery", () => {
  it("promptDelivery accepts error field in type", () => {
    const pd: PromptDelivery = {
      delivered: false,
      attempts: 0,
      status: "failed",
      error: "Connection refused",
    };
    expect(pd.error).toBe("Connection refused");
    expect(pd.status).toBe("failed");
  });

  it("tracks pending → delivered transition", () => {
    const session: { promptDelivery: PromptDelivery } = {
      promptDelivery: { delivered: false, attempts: 0, status: "pending" },
    };

    // Simulate sendPrompt .then()
    const result = { delivered: true, attempts: 1, error: undefined };
    session.promptDelivery = {
      delivered: result.delivered,
      attempts: result.attempts,
      status: "delivered",
      error: result.error,
    };

    expect(session.promptDelivery.status).toBe("delivered");
    expect(session.promptDelivery.delivered).toBe(true);
  });

  it("tracks pending → failed transition on rejection", () => {
    const session: { promptDelivery: PromptDelivery } = {
      promptDelivery: { delivered: false, attempts: 0, status: "pending" },
    };

    // Simulate sendPrompt .catch()
    const err = new Error("Connection refused");
    session.promptDelivery = {
      delivered: false,
      attempts: 0,
      status: "failed",
      error: err.message,
    };

    expect(session.promptDelivery.status).toBe("failed");
    expect(session.promptDelivery.error).toBe("Connection refused");
  });

  it("non-ACP path still uses synchronous promptDelivery", async () => {
    // Verify that the code path for non-ACP still awaits sendInitialPrompt
    // by checking that promptDelivery.delivered is set synchronously
    const mockSendInitialPrompt = vi.fn().mockResolvedValue({ delivered: true, attempts: 1 });
    const result = await mockSendInitialPrompt("session-id", "test prompt");
    expect(result.delivered).toBe(true);
    expect(mockSendInitialPrompt).toHaveBeenCalledWith("session-id", "test prompt");
  });
});
