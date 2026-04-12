# EXECUTABLE UAT CHECKLIST - v0.5.1-alpha

> **Quick reference:** Start from Priority 1 and verify each item with curl/browser before moving next.  
> Each item links to specific endpoint or UI page to test.

---

## PRIORITY 1: CRITICAL PATH (30 min)

### ✅ Server Health
- [ ] **Backend running** → `curl -s http://localhost:9100/v1/health | jq .`
  - Expected: `"status": "ok"`, version `0.5.1-alpha`, `"tmux": {"healthy": true}`

### ✅ Auth System  
- [ ] **Token required** → `curl http://localhost:9100/v1/metrics` (no auth)
  - Expected: `401 Unauthorized`
  
- [ ] **Valid token works** → `curl -H "Authorization: Bearer $AEGIS_TOKEN" http://localhost:9100/v1/metrics`
  - Expected: `200`, returns metrics object

### ✅ Session Lifecycle
```bash
# 1. Create session
SESSION_ID=$(curl -s -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"uat-test-1","workDir":"D:\\aegis"}' | jq -r .id)

# 2. Verify created
curl -s -H "Authorization: Bearer $AEGIS_TOKEN" \
  http://localhost:9100/v1/sessions/$SESSION_ID | jq '.status, .createdAt'
  # Expected: status=idle

# 3. Send prompt
curl -s -X POST http://localhost:9100/v1/sessions/$SESSION_ID/send \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"echo hello"}' | jq '.delivered, .attempts'
  # Expected: delivered=true

# 4. Read output
curl -s http://localhost:9100/v1/sessions/$SESSION_ID/read \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq '.messages | length, .[0].role'
  # Expected: messages array non-empty

# 5. Kill session
curl -s -X DELETE http://localhost:9100/v1/sessions/$SESSION_ID \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq '.ok'
  # Expected: ok=true

# 6. Verify deleted
curl -s http://localhost:9100/v1/sessions/$SESSION_ID \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq '.status'
  # Expected: completed (or 404)
```

### Expected Result
✅ Session create → idle → send → read → kill → completed (clean flow, no errors)

---

## PRIORITY 2: DASHBOARD CORE (20 min)

### ✅ Login & Auth
- [ ] **Navigate** → `http://localhost:5174/dashboard/login`
  - Element: Token input field present
  
- [ ] **Enter token** → Paste `$AEGIS_TOKEN` value
- [ ] **Submit** → Redirected to `/dashboard` (Overview page)
- [ ] **Token persisted** → Reload page, still authenticated (localStorage works)

### ✅ Overview Page  
- [ ] **Metrics cards** → Visible: Active, Total, Avg Duration, Uptime
- [ ] **Session table** → Visible (even if empty)
- [ ] **Activity stream** → Visible (even if empty)

### ✅ Sessions Page
- [ ] **Create session via UI** → "New Session" button opens modal
- [ ] **Enter name & workDir** → Populate form
- [ ] **Submit** → Session created, appears in table
- [ ] **Live update** → Status/age updates in real time (or within 10s)

### ✅ Pipelines Page (Recently Fixed)
- [ ] **No pipelines case** → Shows "No pipelines yet" (not error)
- [ ] **Create pipeline** → "New Pipeline" button works
- [ ] **Pipeline appears** → After creation, visible in list (no reload needed)

### ✅ Audit Page
- [ ] **Load audit logs** → Table populates with records
- [ ] **Timestamp visible** → `ts` field present, shows date string (not "Invalid Date")
- [ ] **Filter by actor** → Dropdowns/search work
- [ ] **Pagination** → Page/pageSize controls present

---

## PRIORITY 3: HOOK SYSTEM (15 min)

### ✅ Hook Endpoint Registration
```bash
HOOK_SECRET="test-secret-$(date +%s)"

# Register UserPromptSubmit hook
curl -s -X POST http://localhost:9100/v1/hooks/UserPromptSubmit \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"http://127.0.0.1:8000/hook-test\",
    \"secret\": \"$HOOK_SECRET\"
  }" | jq '.ok'
  # Expected: ok=true
```

### ✅ Hook Triggering
```bash
# Send prompt (will trigger UserPromptSubmit hook)
# Hook should POST to http://127.0.0.1:8000/hook-test with payload

# Verify in audit trail
curl -s "http://localhost:9100/v1/audit?action=hook" \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq '.records[0].action'
  # Expected: "hook" or "UserPromptSubmit"
```

### ✅ Hook Resilience
- [ ] **Invalid hook URL** → Logged but session continues (non-blocking)
- [ ] **Large payload** → No timeout, processed cleanly
- [ ] **Rapid hooks (100+ per second)** → No dropped events

---

## PRIORITY 4: PIPELINE E2E (20 min)

### ✅ Create Pipeline
```bash
curl -s -X POST http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"uat-pipeline-1",
    "workDir":"D:\\aegis",
    "stages":[
      {"id":"s1","name":"Stage 1","prompt":"echo stage1"},
      {"id":"s2","name":"Stage 2","prompt":"echo stage2"}
    ]
  }' | jq '.id, .status'
  # Expected: id=<uuid>, status=running
```

### ✅ Monitor Execution
```bash
PIPELINE_ID="<from previous>"

# Poll pipeline status
for i in {1..5}; do
  curl -s http://localhost:9100/v1/pipelines/$PIPELINE_ID \
    -H "Authorization: Bearer $AEGIS_TOKEN" | \
    jq '.status, .currentStage, .stageHistory | length'
  sleep 5
done

# Expected: currentStage progresses s1 → s2, status eventually=completed
```

### ✅ Dashboard Pipeline View
- [ ] **Navigate** → `/dashboard/pipelines`
- [ ] **Verify visible** → Pipeline name, status badge, stage count
- [ ] **Metrics cards** → Total, Running, Completed, Failed counts update

---

## PRIORITY 5: REAL-TIME & SSE (15 min)

### ✅ SSE Token Flow
```bash
# Request SSE token
SSE_TOKEN=$(curl -s -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq -r .token)

# Subscribe to events
curl -s "http://localhost:9100/v1/events?token=$SSE_TOKEN" &
CURL_PID=$!

# Trigger event (create session)
curl -s -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"uat-sse-test","workDir":"D:\\aegis"}' > /dev/null

# Wait 2s, kill curl
sleep 2 && kill $CURL_PID 2>/dev/null

# Expected: SSE stream received session creation event
```

### ✅ Dashboard SSE Subscription
- [ ] **Open Overview page** → SSE indicator shows "Live" (green)
- [ ] **Create session via API** → Appears in dashboard < 2 seconds
- [ ] **Disconnect test** → Kill SSE, dashboard falls back to polling
- [ ] **Reconnect** → Refresh page, SSE resumes

---

## PRIORITY 6: ERROR HANDLING & EDGE CASES (15 min)

### ✅ 404 Scenarios
```bash
# Non-existent session
curl -s http://localhost:9100/v1/sessions/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $AEGIS_TOKEN"
  # Expected: 404 with error message
```

### ✅ 429 Rate Limit
```bash
# Exhaust rate limit on an endpoint
for i in {1..30}; do
  curl -s http://localhost:9100/v1/metrics \
    -H "Authorization: Bearer $AEGIS_TOKEN" &
done
wait

# Expected: Some responses = 429 (Too Many Requests) after 10+ concurrent
```

### ✅ Validation Errors
```bash
# Invalid workDir (doesn't exist)
curl -s -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"bad","workDir":"/nonexistent/path"}'
  # Expected: 400 with validation error
```

### ✅ Empty Hook Payloads
```bash
# Stop hook with empty body (should be tolerated)
curl -s -X POST http://localhost:9100/v1/hooks/Stop \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
  # Expected: 200 (not 400)
```

### ✅ Dashboard Load Error State
- [ ] **Navigate Pipelines page**
- [ ] **Force 429** (rapid refresh)
- [ ] **Expected UI** → "Unable to load pipelines" + reason (not "No pipelines yet")

---

## PRIORITY 7: REGRESSION VECTORS (10 min)

### ✅ Audit Trail Timestamp Fix
```bash
# Fetch audit logs, verify field name and parsing
curl -s "http://localhost:9100/v1/audit?pageSize=1" \
  -H "Authorization: Bearer $AEGIS_TOKEN" | \
  jq '.records[0].ts' | date -f - 2>/dev/null

# Expected: Valid date (not "Invalid Date", field is "ts")
```

### ✅ Session Detail Hook Order (No Crash)
- [ ] **Create session**
- [ ] **Navigate to SessionDetail page**
- [ ] **Check browser console** → No "Rendered more hooks than during previous render"

### ✅ Audit Row Keys (No Warnings)
- [ ] **Load Audit page**
- [ ] **View browser console** → No "Each child in a list should have a unique 'key' prop"

### ✅ Hook Resilience (No 400s)
```bash
# Send hook event with unknown fields (should strip, not reject)
SESSION_ID="<existing-session>"

curl -s -X POST http://localhost:9100/v1/hooks/UserPromptSubmit \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId":"'$SESSION_ID'",
    "prompt":"test",
    "unknownField":"should-be-stripped"
  }' | jq '.delivered'
  # Expected: 200 (not 400)
```

---

## QUICK TEST SUITE (Run in 5 min)

```bash
#!/bin/bash
set -e

echo "🧪 5-MIN UAT SMOKE TEST"

# 1. Health
echo "✓ Health..." && curl -s http://localhost:9100/v1/health | jq -e '.status' > /dev/null

# 2. Auth
echo "✓ Auth..." && curl -s -H "Authorization: Bearer $AEGIS_TOKEN" \
  http://localhost:9100/v1/metrics | jq -e '.uptime' > /dev/null

# 3. Session CRUD
echo "✓ Session lifecycle..."
SID=$(curl -s -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-test","workDir":"D:\\aegis"}' | jq -r .id)

curl -s http://localhost:9100/v1/sessions/$SID \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq -e '.status' > /dev/null

curl -s -X DELETE http://localhost:9100/v1/sessions/$SID \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq -e '.ok' > /dev/null

# 4. Audit
echo "✓ Audit trail..."
curl -s "http://localhost:9100/v1/audit?pageSize=1" \
  -H "Authorization: Bearer $AEGIS_TOKEN" | jq -e '.records[0].ts' > /dev/null

# 5. Dashboard
echo "✓ Dashboard accessible..."
curl -s http://localhost:5174/dashboard/login | grep -q "token" > /dev/null

echo "✅ SMOKE TEST PASSED (5 min)"
```

---

## SUCCESS CRITERIA

**All Priority 1-3 pass = Release Ready**

- ✅ No crashes
- ✅ No 500 errors
- ✅ Auth enforced
- ✅ CRUD operations clean
- ✅ Real-time updates < 2s
- ✅ Error messages clear (not misleading)
- ✅ No console warnings (audit rows, hook order)

**Additional Priority 4-7 = High Confidence Release**

---

## KNOWN ISSUES (Already Fixed)

| Issue | Status | Verify |
|-------|--------|--------|
| Audit "Invalid Date" | ✅ Fixed | Check ts field parsing |
| Audit abort on nav | ✅ Fixed | Nav away during load → no crash |
| Hook 400s | ✅ Fixed | Empty/unknown hook payloads accepted |
| SessionDetail crash | ✅ Fixed | No hook-order error in console |
| Pipelines empty state | ✅ Fixed | Load errors show "Unable to load" |

---
