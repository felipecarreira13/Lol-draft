import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import './build.mjs';
const { default: worker } = await import('./dist/server/index.js');

const database = new DatabaseSync(process.env.DRAFT_DATABASE || 'rooms.sqlite');
if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get()) {
  database.exec(readFileSync('drizzle/0000_rooms.sql', 'utf8'));
}
const DB = {
  prepare(query) {
    const statement = database.prepare(query);
    return {
      bind(...args) {
        return {
          first: () => statement.get(...args),
          run: () => ({ meta: { changes: statement.run(...args).changes } }),
        };
      },
    };
  },
};
const port = Number(process.env.DRAFT_PORT || 4173);
const host = process.env.DRAFT_HOST || '127.0.0.1';
createServer(async (incoming, outgoing) => {
  try {
    const request = new Request('http://' + incoming.headers.host + incoming.url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === 'POST' ? { body: incoming, duplex: 'half' } : {}),
    });
    const response = await worker.fetch(request, { DB });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500).end();
  }
}).listen(port, host, () => {
  console.log('Local: http://127.0.0.1:' + port);
  if (host === '0.0.0.0') for (const entry of Object.values(networkInterfaces()).flat()) {
    if (entry.family === 'IPv4' && !entry.internal) console.log('Rede: http://' + entry.address + ':' + port);
  }
});

