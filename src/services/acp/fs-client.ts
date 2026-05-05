import {
  handleAcpFsRequest,
  type AcpFsClientHandlerOptions,
} from './fs-client-handler.js';
import type { AcpJsonRpcClient, AcpJsonRpcInboundRequest } from './json-rpc-client.js';

const FS_METHOD_PREFIX = 'fs/';

export type { AcpFsClientHandlerOptions };

/**
 * Wires ACP fs client methods (fs/read_text_file, fs/write_text_file) into an
 * AcpJsonRpcClient. Subscribes to inbound requests, delegates to
 * handleAcpFsRequest for handling, and sends JSON-RPC responses back.
 */
export class AcpFsClient {
  private readonly workdir: string;

  constructor(
    private readonly rpcClient: AcpJsonRpcClient,
    options: AcpFsClientHandlerOptions
  ) {
    if (!options.workdir || options.workdir.trim() === '') {
      throw new Error('AcpFsClient requires a non-empty workdir');
    }
    this.workdir = options.workdir;
    this.rpcClient.onRequest(request => void this.handleRequest(request));
  }

  private async handleRequest(request: AcpJsonRpcInboundRequest): Promise<void> {
    if (!request.method.startsWith(FS_METHOD_PREFIX)) return;

    try {
      const result = await handleAcpFsRequest(request, { workdir: this.workdir });
      if (result.ok) {
        await this.rpcClient.respond(request.id, result.result);
      } else {
        await this.rpcClient.respondWithError(request.id, result.error);
      }
    } catch {
      // Write errors (e.g., child already exited) are silently dropped;
      // the child process lifecycle handles the disconnect.
    }
  }
}
