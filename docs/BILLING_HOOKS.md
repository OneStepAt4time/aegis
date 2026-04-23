# Billing Hooks Integration Guide

Aegis exposes a billing hook system (Issue #1954) that lets you integrate with external billing providers like Stripe, AWS Market Metering, or custom billing backends.

## Architecture

The billing hook system is built on `BillingMeteringService` — an EventEmitter-based service that records token usage and cost events, then broadcasts `BillingEvent` objects to all registered listeners.

```
Session JSONL → token delta → BillingMeteringService → EventEmitter → your listener
```

## Quick Start

### 1. Import the service

```typescript
import { BillingMeteringService } from '@onestepat4time/aegis/services/billing';
import type { BillingEvent } from '@onestepat4time/aegis/services/billing';
```

### 2. Subscribe to billing events

```typescript
const billing = new BillingMeteringService();

const unsubscribe = billing.onBillingEvent((event: BillingEvent) => {
  console.log(`Session ${event.sessionId}: $${event.costUsd.toFixed(6)}`);
});

// Later: stop listening
unsubscribe();
```

### 3. Record usage

```typescript
// Token usage from JSONL parsing
billing.recordTokenUsage('session-id', 'api-key-id', {
  inputTokens: 1500,
  outputTokens: 800,
  cacheCreationTokens: 200,
  cacheReadTokens: 50,
}, 'claude-sonnet-4-20250514');

// Session lifecycle
billing.recordSessionStart('session-id', 'api-key-id');
billing.recordToolCall('session-id', 'api-key-id', 'Bash', 'claude-sonnet-4-20250514');
billing.recordSessionEnd('session-id', 'api-key-id');
```

## BillingEvent Shape

Every event delivered to listeners has this structure:

```typescript
interface BillingEvent {
  id: number;                // Monotonically increasing ID
  sessionId: string;         // Aegis session ID
  keyId: string | undefined; // API key (undefined when auth disabled)
  timestamp: string;         // ISO 8601
  eventType: 'session_start' | 'session_end' | 'message' | 'tool_call';
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  costUsd: number;           // Estimated cost in USD
  model: string | undefined; // Model name (e.g. 'claude-sonnet-4-20250514')
}
```

## Integration Examples

### Stripe Metered Billing

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

billing.onBillingEvent(async (event) => {
  // Only bill for token usage, not lifecycle events
  if (event.eventType !== 'message') return;

  // Look up the Stripe customer ID from your key mapping
  const customerId = await resolveStripeCustomer(event.keyId);

  await stripe.billing.meterEvents.create({
    event_name: 'aegis_token_usage',
    inputs: {
      value: event.tokens.inputTokens + event.tokens.outputTokens,
    },
    timestamp: Math.floor(Date.now() / 1000),
    identifier: customerId,
  });
});
```

### Custom Webhook

```typescript
billing.onBillingEvent(async (event) => {
  if (event.costUsd === 0) return; // Skip zero-cost events

  await fetch('https://billing.example.com/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.BILLING_TOKEN}` },
    body: JSON.stringify({
      customer_id: event.keyId ?? 'anonymous',
      amount_usd: event.costUsd,
      session_id: event.sessionId,
      model: event.model,
      recorded_at: event.timestamp,
    }),
  });
});
```

### Aggregated Cost Reporting

Use the query API to get aggregated cost breakdowns:

```typescript
// Total usage for a key
const summary = billing.getUsageSummary({ keyId: 'key-abc' });
console.log(`Total: $${summary.totalCostUsd} across ${summary.sessionCount} sessions`);

// Per-key breakdown
const byKey = billing.getCostByKey({ from: '2025-01-01T00:00:00Z' });
for (const record of byKey) {
  console.log(`${record.keyId}: $${record.totalCostUsd} (${record.recordCount} records)`);
}

// Per-session detail
const sessionRecords = billing.getSessionUsage('session-id');
```

## Cost Estimation

Cost is estimated using configurable rate tiers. Default tiers follow Anthropic's public pricing:

| Tier   | Input $/M | Output $/M | Cache Write $/M | Cache Read $/M |
|--------|-----------|------------|-----------------|----------------|
| Haiku  | $0.80     | $4.00      | $1.00           | $0.08          |
| Sonnet | $3.00     | $15.00     | $3.75           | $0.30          |
| Opus   | $15.00    | $75.00     | $18.75          | $1.50          |

### Custom Rate Tiers

Pass custom tiers to the constructor or update at runtime:

```typescript
const billing = new BillingMeteringService([
  {
    name: 'glm-5',
    inputCostPerM: 2.00,
    outputCostPerM: 10.00,
    cacheWriteCostPerM: 2.50,
    cacheReadCostPerM: 0.20,
    modelPattern: 'glm',
  },
]);

// Or update at runtime
billing.setRateTiers([...newTiers]);
```

## Data Pruning

Remove old records to bound memory usage:

```typescript
// Remove records older than 90 days
const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
const removed = billing.pruneOlderThan(cutoff);
console.log(`Pruned ${removed} old records`);
```

## Error Handling

Billing event listeners are invoked via `setImmediate` and errors are caught internally — a failing listener will never block recording or crash the service. Wrap your own async logic in try/catch to avoid silent failures.

```typescript
billing.onBillingEvent(async (event) => {
  try {
    await sendToExternalBilling(event);
  } catch (err) {
    // Log and retry on your own schedule
    console.error('Billing integration error:', err);
  }
});
```
