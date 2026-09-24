/**
 * socket.io-client.d.ts — Stub type declaration for optional dependency.
 *
 * socket.io-client — опциональная зависимость. Если пакет установлен
 * (npm install socket.io-client), TypeScript подхватит его собственные типы.
 * Если НЕ установлен — используется эта заглушка, чтобы `import("socket.io-client")`
 * не падал с TS2307 "Cannot find module".
 *
 * Реальные типы socket.io-client намного богаче (Manager, SocketNamespace, etc.),
 * но нам нужны только `io` и базовый `Socket` для динамического импорта в
 * use-socket-io.ts.
 *
 * Чтобы заменить эту заглушку на настоящие типы:
 *   npm install socket.io-client
 *   // TypeScript автоматически подхватит ../node_modules/socket.io-client/build/esm/index.d.ts
 */

declare module "socket.io-client" {
  export interface Socket {
    on(event: string, listener: (...args: unknown[]) => void): this;
    off(event?: string, listener?: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    emit(event: string, ...args: unknown[]): this;
    disconnect(): this;
    connect(): this;
    close(): this;
    connected: boolean;
    disconnected: boolean;
    id: string;
  }

  export interface ManagerOptions {
    [key: string]: unknown;
  }

  export interface SocketOptions {
    [key: string]: unknown;
  }

  export function io(
    uri?: string,
    opts?: Partial<ManagerOptions & SocketOptions>
  ): Socket;

  const defaultExport: { io: typeof io };
  export default defaultExport;
}
