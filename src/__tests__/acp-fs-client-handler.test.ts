import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';

import {
  handleAcpFsRequest,
  ACP_FS_ERROR_INVALID_PARAMS,
  ACP_FS_ERROR_PATH_TRAVERSAL,
  ACP_FS_ERROR_IO,
  ACP_FS_ERROR_METHOD_NOT_FOUND,
} from '../services/acp/fs-client-handler.js';
import type { AcpFsClientHandlerOptions } from '../services/acp/fs-client-handler.js';
import type { AcpJsonObject, AcpJsonRpcInboundRequest } from '../services/acp/json-rpc-client.js';

function makeRequest(
  method: string,
  params: AcpJsonObject | undefined,
  id: number | string | null = 1
): AcpJsonRpcInboundRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
    raw: { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) },
  };
}

describe('ACP fs client handler', () => {
  let workdir: string;
  let options: AcpFsClientHandlerOptions;

  beforeEach(async () => {
    workdir = join(tmpdir(), `aegis-acp-fs-test-${randomUUID()}`);
    await mkdir(workdir, { recursive: true });
    options = { workdir };
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe('fs/read_text_file', () => {
    it('reads a file within the workdir and returns its content', async () => {
      await writeFile(join(workdir, 'hello.txt'), 'Hello, ACP!');

      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: 'hello.txt' }),
        options
      );

      expect(result).toEqual({ ok: true, result: { content: 'Hello, ACP!' } });
    });

    it('reads a file in a subdirectory within the workdir', async () => {
      await mkdir(join(workdir, 'sub'), { recursive: true });
      await writeFile(join(workdir, 'sub', 'data.txt'), 'nested content');

      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: 'sub/data.txt' }),
        options
      );

      expect(result).toEqual({ ok: true, result: { content: 'nested content' } });
    });

    it('rejects a path that escapes the workdir via ../', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: '../../../etc/passwd' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_PATH_TRAVERSAL, message: expect.any(String) },
      });
    });

    it('rejects an absolute path outside the workdir', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: '/etc/passwd' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_PATH_TRAVERSAL, message: expect.any(String) },
      });
    });

    it('returns an IO error when the file does not exist', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: 'missing.txt' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_IO, message: expect.any(String) },
      });
    });

    it('returns invalid params when path is missing', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', {}),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });

    it('returns invalid params when params is absent', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', undefined),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });

    it('returns invalid params when path is not a string', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: 42 }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });

    it('returns invalid params when path is an empty string', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/read_text_file', { path: '' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });
  });

  describe('fs/write_text_file', () => {
    it('writes a file within the workdir', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { path: 'out.txt', content: 'written by ACP' }),
        options
      );

      expect(result).toEqual({ ok: true, result: {} });
      const written = await readFile(join(workdir, 'out.txt'), 'utf8');
      expect(written).toBe('written by ACP');
    });

    it('creates intermediate directories when writing a nested path', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { path: 'a/b/c.txt', content: 'deep' }),
        options
      );

      expect(result).toEqual({ ok: true, result: {} });
      const written = await readFile(join(workdir, 'a', 'b', 'c.txt'), 'utf8');
      expect(written).toBe('deep');
    });

    it('rejects a path that escapes the workdir via ../', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { path: '../../evil.txt', content: 'bad' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_PATH_TRAVERSAL, message: expect.any(String) },
      });
    });

    it('rejects an absolute path outside the workdir', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { path: '/tmp/evil.txt', content: 'bad' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_PATH_TRAVERSAL, message: expect.any(String) },
      });
    });

    it('returns invalid params when path is missing', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { content: 'no path' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });

    it('returns invalid params when content is missing', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { path: 'file.txt' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });

    it('returns invalid params when content is not a string', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', { path: 'file.txt', content: 123 }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });

    it('returns invalid params when params is absent', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/write_text_file', undefined),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_INVALID_PARAMS, message: expect.any(String) },
      });
    });
  });

  describe('unknown methods', () => {
    it('returns method not found for an unrecognized fs/* method', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('fs/delete_file', { path: 'file.txt' }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_METHOD_NOT_FOUND, message: expect.any(String) },
      });
    });

    it('returns method not found for a non-fs method', async () => {
      const result = await handleAcpFsRequest(
        makeRequest('session/request_permission', { toolCall: {} }),
        options
      );

      expect(result).toEqual({
        ok: false,
        error: { code: ACP_FS_ERROR_METHOD_NOT_FOUND, message: expect.any(String) },
      });
    });
  });
});
