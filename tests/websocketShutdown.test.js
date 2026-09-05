// http.Server#close waits on every open connection, and Socket.IO connections are long-lived.
// Uses a real server + client: the bug only shows up in the interaction between the two.

const http = require("http");
const { io: Client } = require("socket.io-client");

const {
  initWebSocket,
  closeWebSocket,
  getWebSocketStats,
} = require("../src/services/comms/websocket");

/** Resolves true if the HTTP server finished closing within `ms`. */
function closeWithin(server, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    server.close(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function connectClient(port) {
  const client = Client(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    reconnection: false,
  });
  return new Promise((resolve) => client.on("connect", () => resolve(client)));
}

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

describe("WebSocket shutdown", () => {
  let server;
  let client;

  afterEach(() => {
    client?.close();
    if (server?.listening) server.close();
  });

  it("lets the HTTP server finish closing while a client is connected", async () => {
    server = http.createServer();
    initWebSocket(server);
    const port = await listen(server);
    client = await connectClient(port);

    expect(getWebSocketStats().clients).toBe(1);

    await closeWebSocket();
    await expect(closeWithin(server, 2000)).resolves.toBe(true);
  });

  it("hangs if clients are not disconnected first (pins the original bug)", async () => {
    server = http.createServer();
    initWebSocket(server);
    const port = await listen(server);
    client = await connectClient(port);

    await expect(closeWithin(server, 750)).resolves.toBe(false);

    await closeWebSocket();
  });

  it("reports the socket layer as inactive afterwards", async () => {
    server = http.createServer();
    initWebSocket(server);
    await listen(server);

    await closeWebSocket();
    expect(getWebSocketStats()).toEqual({ connected: false, clients: 0 });
  });

  it("is safe to call when no server was ever started", async () => {
    await expect(closeWebSocket()).resolves.toBeUndefined();
  });
});
