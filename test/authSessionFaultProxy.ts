/**
 * AURA-AUTH-SESSION-01-I1 R1 -- test-only TCP fault-injection proxy between a
 * pg client and a DISPOSABLE loopback PostgreSQL. node:net only (no dependency).
 *
 * When a client->server chunk contains `trigger` text, the next queued fault
 * is applied to THAT connection:
 *   'pass'                 forward normally;
 *   'drop-after-forward'   forward the chunk to the server (so it executes,
 *                          including any COMMIT in the same message), then
 *                          cut the client side: the client sees a lost
 *                          connection -- an UNCERTAIN outcome that did commit;
 *   'drop-before-forward'  cut both sides without forwarding: the server never
 *                          receives the statement -- an outcome that did NOT commit;
 *   'blackhole'            forward the chunk, then silently discard every
 *                          server->client byte on that connection: the client
 *                          waits until its own deadline.
 */
import net from 'net';

export type Fault = 'pass' | 'drop-after-forward' | 'drop-before-forward' | 'blackhole';

export interface FaultProxy {
  port: number;
  url: string;
  queue: Fault[];
  triggered: Fault[];
  close(): Promise<void>;
}

export async function startFaultProxy(upstreamUrl: string, trigger: string): Promise<FaultProxy> {
  const up = new URL(upstreamUrl);
  if (!['127.0.0.1', 'localhost'].includes(up.hostname)) throw new Error('fault proxy: loopback upstream only');
  const sockets = new Set<net.Socket>();
  const proxy: FaultProxy = { port: 0, url: '', queue: [], triggered: [], close: async () => {} };
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(up.port || 5432), up.hostname);
    sockets.add(client);
    sockets.add(upstream);
    let blackholed = false;
    const cut = () => {
      client.destroy();
      setTimeout(() => upstream.destroy(), 300);
    };
    client.on('data', (chunk) => {
      if (chunk.includes(trigger) && proxy.queue.length > 0) {
        const fault = proxy.queue.shift() as Fault;
        proxy.triggered.push(fault);
        if (fault === 'drop-before-forward') {
          client.destroy();
          upstream.destroy();
          return;
        }
        upstream.write(chunk);
        if (fault === 'drop-after-forward') cut();
        if (fault === 'blackhole') blackholed = true;
        return;
      }
      upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      if (!blackholed && !client.destroyed) client.write(chunk);
    });
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', end);
    upstream.on('error', end);
    client.on('close', () => {
      if (!blackholed) upstream.end();
    });
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  proxy.port = (server.address() as net.AddressInfo).port;
  const u = new URL(upstreamUrl);
  u.hostname = '127.0.0.1';
  u.port = String(proxy.port);
  proxy.url = u.toString();
  proxy.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    });
  return proxy;
}
