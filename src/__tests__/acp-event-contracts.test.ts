import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  mapAcpJsonRpcErrorResponseToEvent,
  mapAcpJsonRpcNotificationToEvent,
  mapAcpJsonRpcRequestToEvent,
  mapAcpJsonRpcSuccessResponseToEvent,
} from '../services/acp/event-mapper.js';
import {
  acpGoldenEventFrames,
  acpGoldenEventMapperContext,
  type AcpGoldenEventFrame,
} from './fixtures/acp-golden-events.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const expectedEventFixturePath = path.join(
  testDir,
  'fixtures',
  'acp-golden-events',
  'event-mapper.expected.json'
);

describe('ACP golden event contracts', () => {
  it('serializes representative ACP frames into stable Aegis domain events', () => {
    const mappedEvents = acpGoldenEventFrames.map(frame => mapGoldenFrame(frame));
    const serializedEvents = JSON.parse(JSON.stringify(mappedEvents));

    expect(serializedEvents).toEqual(readJsonFixture(expectedEventFixturePath));
  });
});

function mapGoldenFrame(frame: AcpGoldenEventFrame): unknown {
  switch (frame.kind) {
    case 'notification':
      return mapAcpJsonRpcNotificationToEvent(frame.frame, acpGoldenEventMapperContext);
    case 'inboundRequest':
      return mapAcpJsonRpcRequestToEvent(frame.frame, acpGoldenEventMapperContext);
    case 'successResponse':
      return mapAcpJsonRpcSuccessResponseToEvent(frame.frame, acpGoldenEventMapperContext);
    case 'errorResponse':
      return mapAcpJsonRpcErrorResponseToEvent(frame.frame, acpGoldenEventMapperContext);
  }
  return assertNever(frame);
}

function readJsonFixture(pathname: string): unknown {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ACP golden frame: ${JSON.stringify(value)}`);
}
