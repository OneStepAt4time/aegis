/**
 * useApprovalStore tests.
 * Related: #3622 Tier 1
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useApprovalStore } from "../useApprovalStore";

describe("useApprovalStore", () => {
  beforeEach(() => {
    useApprovalStore.setState({ pending: new Map() });
  });

  it("starts empty", () => {
    expect(useApprovalStore.getState().count()).toBe(0);
    expect(useApprovalStore.getState().list()).toEqual([]);
  });

  it("addApproval adds an entry", () => {
    useApprovalStore.getState().addApproval({
      sessionId: "abc",
      sessionName: "test-session",
      startedAt: Date.now(),
    });
    expect(useApprovalStore.getState().count()).toBe(1);
    const entry = useApprovalStore.getState().list()[0];
    expect(entry.sessionId).toBe("abc");
    expect(entry.sessionName).toBe("test-session");
  });

  it("removeApproval removes the entry", () => {
    useApprovalStore.getState().addApproval({
      sessionId: "abc",
      sessionName: "test-session",
      startedAt: Date.now(),
    });
    useApprovalStore.getState().removeApproval("abc");
    expect(useApprovalStore.getState().count()).toBe(0);
  });

  it("setFromSessions filters permission_prompt sessions", () => {
    useApprovalStore.getState().setFromSessions([
      {
        id: "s1",
        displayName: "waiting",
        status: "permission_prompt",
        pendingPermission: { toolName: "bash", startedAt: 1000, expiresAt: 2000 },
      },
      {
        id: "s2",
        displayName: "working",
        status: "working",
        pendingPermission: null,
      },
      {
        id: "s3",
        displayName: "another-waiting",
        status: "permission_prompt",
        pendingPermission: { startedAt: 3000 },
      },
    ]);
    expect(useApprovalStore.getState().count()).toBe(2);
    const ids = useApprovalStore.getState().list().map((a) => a.sessionId);
    expect(ids).toContain("s1");
    expect(ids).toContain("s3");
  });

  it("setFromSessions replaces all existing entries", () => {
    useApprovalStore.getState().addApproval({
      sessionId: "old",
      sessionName: "old-session",
      startedAt: Date.now(),
    });
    useApprovalStore.getState().setFromSessions([]);
    expect(useApprovalStore.getState().count()).toBe(0);
  });

  it("addApproval updates existing entry for same session", () => {
    useApprovalStore.getState().addApproval({
      sessionId: "abc",
      sessionName: "first",
      startedAt: 1000,
    });
    useApprovalStore.getState().addApproval({
      sessionId: "abc",
      sessionName: "updated",
      startedAt: 2000,
    });
    expect(useApprovalStore.getState().count()).toBe(1);
    expect(useApprovalStore.getState().list()[0].sessionName).toBe("updated");
  });
});
