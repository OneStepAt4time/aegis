# Plan: Session Ownership Model (RBAC) — Issue #1429

## Context

Any API key can operate on any session (SD-AUTHZ-01). Key A can approve Key B's permission prompts, kill sessions it didn't create, etc. We need to add an `ownerKeyId` field to sessions and enforce ownership checks on all mutating (and sensitive read) endpoints.

## Approach: Ownership guard helper + field threading

Add `ownerKeyId` to `SessionInfo`, stamp it on creation, and enforce via a reusable `requireOwnership()` guard that every protected route calls early.

### Files to modify

1. **`src/session.ts`** — Add `ownerKeyId?: string` to `SessionInfo`; accept it in `createSession()` opts; stamp on line 696
2. **`src/api-contracts.ts`** — Add `ownerKeyId?: string` to the API-facing `SessionInfo` (line 24-46)
3. **`src/validation.ts`** — Add `ownerKeyId: z.string().optional()` to `persistedStateSchema` (line ~222)
4. **`src/server.ts`** — Add `requireOwnership()` guard; call it in all protected handlers; pass `req.authKeyId` into `createSession()`
5. **`src/permission-routes.ts`** — Thread ownership check into approve/reject handlers

### Detailed changes

#### 1. `src/session.ts`

- **Line 88** — Add `ownerKeyId?: string;` to `SessionInfo` interface
- **Line 546-560** — Add `ownerKeyId?: string` to `createSession` opts
- **Line 676-696** — Set `ownerKeyId: opts.ownerKeyId` in the session object construction
- **Line 928-933** — Add optional `filterByOwner?: string` param to `listSessions()` for owner-scoped listing

#### 2. `src/api-contracts.ts`

- **After line 46** — Add `ownerKeyId?: string;` to the API `SessionInfo`

#### 3. `src/validation.ts`

- **Line ~222** — Add `ownerKeyId: z.string().optional()` to the persisted state schema

#### 4. `src/server.ts` — the bulk of the work

**a) Ownership guard function** (new helper, placed near top with other helpers):
```ts
function requireOwnership(sessionId: string, reply: FastifyReply, keyId: string | null | undefined): SessionInfo | null {
  const session = sessions.getSession(sessionId);
  if (!session) { reply.status(404).send({ error: 'Session not found' }); return null; }
  // Master key and no-auth mode bypass ownership
  if (keyId === 'master' || keyId === null || keyId === undefined) return session;
  if (session.ownerKeyId && session.ownerKeyId !== keyId) {
    reply.status(403).send({ error: 'Forbidden: session owned by another API key' });
    return null;
  }
  return session;
}
```

**b) Session creation** (`createSessionHandler`, line ~876):
- Pass `ownerKeyId: req.authKeyId` to `sessions.createSession()`

**c) Spawn/fork** (lines ~1024, ~1044):
- Pass `ownerKeyId: req.authKeyId` to child sessions (inherits parent's owner)

**d) Protected routes — add `requireOwnership()` call:**

| Handler | Line | Action |
|---------|------|--------|
| `sendMessageHandler` | 974 | Guard before `sessions.sendMessage()` |
| `escapeHandler` | 1209 | Guard before `sessions.escape()` |
| `interruptHandler` | 1221 | Guard before `sessions.interrupt()` |
| `killSessionHandler` | 1233 | Guard replaces manual `getSession` check |
| `capturePaneHandler` | 1253 | Guard replaces manual `getSession` check |
| `commandHandler` | 1264 | Guard before `sessions.sendMessage()` |
| `bashHandler` | 1280 | Guard before `sessions.sendMessage()` |
| `readMessagesHandler` | 1167 | Guard before `sessions.readMessages()` |
| `summaryHandler` | 1296 | Guard before `sessions.getSummary()` |
| Transcript (line 1310) | 1310 | Guard before `sessions.readTranscript()` |
| Transcript cursor (line 1330) | 1330 | Guard before transcript cursor read |
| `verify` (line 1590) | 1590 | Guard replaces manual `getSession` check |
| GET session (line 929) | 929 | Guard replaces manual `getSession` check |
| Batch delete (line 774) | 774 | Filter by ownership for non-master keys |
| List sessions (line 714) | 714 | Scope to owner when not master/no-auth |

**e) Permission routes** (`src/permission-routes.ts`):
- `registerPermissionRoutes` needs access to `sessions.getSession()` to check ownership
- Add ownership guard in `createPermissionHandler()` before approve/reject calls

#### 5. Tests — new file `src/__tests__/session-ownership-1429.test.ts`

Test cases:
- Creating a session stamps `ownerKeyId`
- Owner key can operate on own session → 200
- Non-owner key gets 403 on send/approve/reject/kill/interrupt/escape/capture/transcript
- Master key can operate on any session → 200
- No-auth mode (keyId=null) bypasses ownership → 200
- Session without `ownerKeyId` (legacy) allows all access (backward compat)
- `listSessions` scopes to owner when filtered
- Batch delete scopes to owner

### Backward compatibility

- `ownerKeyId` is optional (`string | undefined`)
- Existing sessions persisted without it will have `undefined` — the guard treats `!session.ownerKeyId` as "no owner" and allows access (backward compat)
- Auth-disabled mode (`keyId === null`) bypasses all ownership checks
- Master key (`keyId === 'master'`) can operate on all sessions

### Verification

```bash
npx tsc --noEmit    # type check
npm run build       # build
npm test            # all tests pass
```

Then manually:
1. Start server with auth token, create two API keys
2. Key A creates a session → verify `ownerKeyId` in response
3. Key B tries to send/kill/approve → verify 403
4. Master token operates on Key A's session → verify 200
