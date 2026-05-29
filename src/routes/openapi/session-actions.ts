/**
 * openapi/session-actions.ts — Session action path registrations.
 *
 * Covers: send, command, escape, interrupt, kill, children, spawn, fork,
 *         approve, reject, quick approve/reject, answer, pause, resume,
 *         cancel, intervention start/complete/status.
 */

import { z } from 'zod';
import { registerOpenApiPath } from '../../openapi.js';
import {
  validationErrorResponse,
  sendMessageSchema,
  commandSchema,
  pauseSessionSchema,
  resumeSessionSchema,
  cancelSessionSchema,
  startInterventionSchema,
  completeInterventionSchema,
  spawnSchema,
  forkSchema,
  answerSchema,
  okJsonResponse,
  notFoundResponse,
} from './common.js';

/** Register session action path descriptors. */
export function registerSessionActionPaths(): void {
  // ── Session Actions ─────────────────────────────────────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/send',
    summary: 'Send message to session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: sendMessageSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), delivered: z.boolean(), attempts: z.number(), reason: z.string().optional() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/command',
    summary: 'Send slash command',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: commandSchema } } },
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/escape',
    summary: 'Send Escape key',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/interrupt',
    summary: 'Send Ctrl+C',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'delete',
    path: '/v1/sessions/{id}',
    summary: 'Kill session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/children',
    summary: 'Get child sessions',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Parent session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ children: z.array(z.any()) })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/spawn',
    summary: 'Spawn child session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Parent session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: spawnSchema } } },
    responses: { '201': okJsonResponse(z.any()), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/fork',
    summary: 'Fork session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Parent session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: forkSchema } } },
    responses: { '201': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/approval/approve',
    summary: 'Approve permission request',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/approval/reject',
    summary: 'Reject permission request',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  // Issue #4193: Quick approve/reject dedicated endpoints
  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/permission/approve',
    summary: 'Quick approve permission request (dashboard inline button)',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: z.object({ approverId: z.string().optional() }) } } },
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '403': { description: 'Forbidden: missing approve permission' }, '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/permission/reject',
    summary: 'Quick reject permission request (dashboard inline button)',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: z.object({ reason: z.string().optional() }) } } },
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '403': { description: 'Forbidden: missing reject permission' }, '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/answer',
    summary: 'Answer pending question',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: answerSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean() })),
      '400': validationErrorResponse(),
      '409': { description: 'No pending question matching this questionId' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/pause',
    summary: 'Pause session',
    description: 'Temporarily pause a running session.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: pauseSessionSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), pausedAt: z.number() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
      '409': { description: 'Session not in a pausable state' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/resume',
    summary: 'Resume session',
    description: 'Resume a paused session.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: resumeSessionSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), resumedAt: z.number() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
      '409': { description: 'Session not in a resumable state' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/cancel',
    summary: 'Cancel session',
    description: 'Cancel the current turn in a session.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: cancelSessionSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), cancelledAt: z.number() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
      '409': { description: 'Session not in a cancellable state' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/intervention/start',
    summary: 'Start human intervention',
    description: 'Flag a session as under human intervention.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: startInterventionSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), interventionStartedAt: z.number() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
      '409': { description: 'Intervention already active' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/intervention/complete',
    summary: 'Complete human intervention',
    description: 'Resolve an active human intervention on a session.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: completeInterventionSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), interventionCompletedAt: z.number() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
      '409': { description: 'No active intervention' },
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/intervention',
    summary: 'Get intervention status',
    description: 'Return the current intervention state for a session.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: {
      '200': okJsonResponse(z.object({ active: z.boolean(), startedAt: z.number().nullable(), startedBy: z.string().nullable(), guidance: z.string().nullable() })),
      '404': notFoundResponse,
    },
  });
}
