/*
 * SPDX-FileCopyrightText: 2021 The HedgeDoc developers (see AUTHORS file)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import {
  HttpServer,
  INestApplication,
  Logger,
  WebSocketAdapter,
} from '@nestjs/common';
import { CONNECTION_EVENT, ERROR_EVENT } from '@nestjs/websockets/constants';
import http from 'http';
import https from 'https';
import { decoding } from 'lib0';
import WebSocket, { Server, ServerOptions } from 'ws';

import { MessageType } from './message-type';
import { NoteIdWebsocket } from './note-id-websocket';

export type MessageHandlerCallbackResponse = Promise<Uint8Array | void>;

type WebServer = http.Server | https.Server;

interface MessageHandler {
  message: string;
  callback: (decoder: decoding.Decoder) => MessageHandlerCallbackResponse;
}

export class YjsAdapter
  implements WebSocketAdapter<Server, NoteIdWebsocket, ServerOptions>
{
  protected readonly logger = new Logger(YjsAdapter.name);
  private readonly httpServer: HttpServer;

  constructor(private app: INestApplication) {
    this.httpServer = app.getHttpServer() as HttpServer;
  }

  bindMessageHandlers(
    client: NoteIdWebsocket,
    handlers: MessageHandler[],
  ): void {
    client.binaryType = 'arraybuffer';
    client.on('message', (data: ArrayBuffer) => {
      const uint8Data = new Uint8Array(data);
      const decoder = decoding.createDecoder(uint8Data);
      const messageType = decoding.readVarUint(decoder);
      const handler = handlers.find(
        (handler) => handler.message === MessageType[messageType],
      );
      if (!handler) {
        this.logger.error('Some message handlers were not defined!');
        return;
      }
      handler
        .callback(decoder)
        .then((response) => {
          if (!response) {
            return;
          }
          client.send(response, {
            binary: true,
          });
        })
        .catch((error: Error) => {
          this.logger.error(
            'An error occurred while handling message: ' + String(error),
          );
        });
    });
  }

  create(port: number, options?: ServerOptions): Server {
    this.logger.log('Initiating WebSocket server for realtime communication');
    if (this.httpServer) {
      this.logger.log('Using existing WebServer for WebSocket communication');
      const server = new Server({
        server: this.httpServer as unknown as WebServer,
        ...options,
      });
      return this.bindErrorHandler(server);
    }
    this.logger.log('Using new WebSocket server instance');
    const server = new Server({
      port,
      ...options,
    });
    return this.bindErrorHandler(server);
  }

  bindErrorHandler(server: Server): Server {
    server.on(CONNECTION_EVENT, (ws) =>
      ws.on(ERROR_EVENT, (err: Error) => this.logger.error(err)),
    );
    server.on(ERROR_EVENT, (err: Error) => this.logger.error(err));
    return server;
  }

  bindClientConnect(
    server: WebSocket.Server,
    callback: (
      this: Server,
      socket: NoteIdWebsocket,
      request: http.IncomingMessage,
    ) => void,
  ): void {
    server.on('connection', callback);
  }

  bindClientDisconnect(
    client: NoteIdWebsocket,
    callback: (socket: NoteIdWebsocket) => void,
  ): void {
    client.on('close', callback);
  }

  close(server: WebSocket.Server): void {
    // TODO Check if clean-up with server is needed.
    this.logger.warn('WebSocket server closed.');
  }
}
