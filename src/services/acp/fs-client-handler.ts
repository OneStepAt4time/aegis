import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { AcpJsonRpcInboundRequest, AcpJsonValue } from './json-rpc-client.js';

export const ACP_FS_ERROR_INVALID_PARAMS = -32602;
export const ACP_FS_ERROR_PATH_TRAVERSAL = -32001;
export const ACP_FS_ERROR_IO = -32002;
export const ACP_FS_ERROR_METHOD_NOT_FOUND = -32601;

export interface AcpFsClientHandlerOptions {
  workdir: string;
}

export type AcpFsHandlerResult =
  | { ok: true; result: AcpJsonValue }
  | { ok: false; error: { code: number; message: string } };

export async function handleAcpFsRequest(
  request: AcpJsonRpcInboundRequest,
  options: AcpFsClientHandlerOptions
): Promise<AcpFsHandlerResult> {
  switch (request.method) {
    case 'fs/read_text_file':
      return handleReadTextFile(request, options);
    case 'fs/write_text_file':
      return handleWriteTextFile(request, options);
    default:
      return {
        ok: false,
        error: { code: ACP_FS_ERROR_METHOD_NOT_FOUND, message: `Method not found: ${request.method}` },
      };
  }
}

async function handleReadTextFile(
  request: AcpJsonRpcInboundRequest,
  options: AcpFsClientHandlerOptions
): Promise<AcpFsHandlerResult> {
  const params = asObject(request.params);
  const path = params !== undefined ? readString(params.path) : undefined;

  if (path === undefined) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: 'fs/read_text_file requires a non-empty string path parameter' },
    };
  }

  const resolvedPath = resolve(options.workdir, path);
  if (!isWithinWorkdir(resolvedPath, options.workdir)) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_PATH_TRAVERSAL, message: `Path traversal denied: resolved path is outside workdir` },
    };
  }

  try {
    const content = await readFile(resolvedPath, 'utf8');
    return { ok: true, result: { content } };
  } catch (err) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_IO, message: ioErrorMessage(err, resolvedPath) },
    };
  }
}

async function handleWriteTextFile(
  request: AcpJsonRpcInboundRequest,
  options: AcpFsClientHandlerOptions
): Promise<AcpFsHandlerResult> {
  const params = asObject(request.params);
  const path = params !== undefined ? readString(params.path) : undefined;
  const content = params !== undefined ? readStringOrEmpty(params.content) : undefined;

  if (path === undefined) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: 'fs/write_text_file requires a non-empty string path parameter' },
    };
  }

  if (content === undefined) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: 'fs/write_text_file requires a string content parameter' },
    };
  }

  const resolvedPath = resolve(options.workdir, path);
  if (!isWithinWorkdir(resolvedPath, options.workdir)) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_PATH_TRAVERSAL, message: `Path traversal denied: resolved path is outside workdir` },
    };
  }

  try {
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content, 'utf8');
    return { ok: true, result: {} };
  } catch (err) {
    return {
      ok: false,
      error: { code: ACP_FS_ERROR_IO, message: ioErrorMessage(err, resolvedPath) },
    };
  }
}

function isWithinWorkdir(resolvedPath: string, workdir: string): boolean {
  const normalizedWorkdir = resolve(workdir);
  return resolvedPath === normalizedWorkdir || resolvedPath.startsWith(`${normalizedWorkdir}/`);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readStringOrEmpty(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function ioErrorMessage(err: unknown, path: string): string {
  if (err instanceof Error) {
    return `IO error for path ${path}: ${err.message}`;
  }
  return `IO error for path ${path}`;
}
