export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      server.send(JSON.stringify({
        type: "connected"
      }));

      try {
        const messages =
          await this.ctx.storage.get("messages") || [];

        for (const message of messages) {
          server.send(JSON.stringify({
            type: "history",
            ...message
          }));
        }

        server.send(JSON.stringify({
          type: "history_end"
        }));

      } catch (error) {

        server.send(JSON.stringify({
          type: "error",
          message: "Could not load chat history."
        }));
      }

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    if (url.pathname === "/history") {

      try {

        const messages =
          await this.ctx.storage.get("messages") || [];

        return Response.json(messages);

      } catch (error) {

        return Response.json(
          {
            error: "Could not load history."
          },
          {
            status: 500
          }
        );
      }
    }

    if (url.pathname === "/health") {

      return Response.json({
        status: "ok",
        service: "ARASH MESSENGER",
        chat: "online"
      });
    }

    return new Response(
      "ARASH MESSENGER CHAT ROOM ONLINE"
    );
  }

  async webSocketMessage(ws, message) {

    try {

      const data = JSON.parse(message);

      // ====================================================
      // NEW MESSAGE
      // ====================================================

      if (data.type === "message") {

        const text =
          String(data.message || "").trim();

        if (!text) {
          return;
        }

        const messages =
          await this.ctx.storage.get("messages") || [];

        const newMessage = {

          id:
            String(
              data.message_id ||
              (
                Date.now().toString() +
                "-" +
                Math.random()
                  .toString(36)
                  .substring(2, 8)
              )
            ),

          client_id:
            String(
              data.client_id || ""
            ),

          sender:
            "Someone",

          message:
            text,

          time:
            String(
              data.time ||
              new Date().toISOString()
            )
        };

        messages.push(newMessage);

        if (messages.length > 1000) {

          messages.splice(
            0,
            messages.length - 1000
          );
        }

        await this.ctx.storage.put(
          "messages",
          messages
        );

        const payload =
          JSON.stringify({
            type: "message",
            ...newMessage
          });

        this.broadcast(payload);

        return;
      }

      // ====================================================
      // DELETE MESSAGE
      // ====================================================

      if (data.type === "delete") {

        const messageId =
          String(
            data.message_id || ""
          );

        const clientId =
          String(
            data.client_id || ""
          );

        const deleteMode =
          String(
            data.mode || "everyone"
          );

        if (!messageId) {
          return;
        }

        const messages =
          await this.ctx.storage.get("messages") || [];

        const index =
          messages.findIndex(
            item =>
              String(item.id) === messageId
          );

        if (index === -1) {
          return;
        }

        const target =
          messages[index];

        // Only the original sender can delete
        // a message for everyone.

        if (
          deleteMode === "everyone" &&
          String(target.client_id || "") !== clientId
        ) {

          ws.send(JSON.stringify({
            type: "error",
            message: "You cannot delete this message."
          }));

          return;
        }

        // For everyone, permanently remove it
        // from Cloudflare history.

        if (deleteMode === "everyone") {

          messages.splice(
            index,
            1
          );

          await this.ctx.storage.put(
            "messages",
            messages
          );

          this.broadcast(
            JSON.stringify({
              type: "deleted",
              message_id: messageId,
              mode: "everyone"
            })
          );

          return;
        }

        return;
      }

    } catch (error) {

      try {

        ws.send(JSON.stringify({
          type: "error",
          message: "Invalid message."
        }));

      } catch (e) {
        // Ignore.
      }
    }
  }

  // ========================================================
  // BROADCAST
  // ========================================================

  broadcast(payload) {

    const sockets =
      this.ctx.getWebSockets();

    for (const socket of sockets) {

      try {

        socket.send(payload);

      } catch (error) {

        // Ignore dead connections.
      }
    }
  }

  // ========================================================
  // CLOSE
  // ========================================================

  async webSocketClose(
    ws,
    code,
    reason,
    wasClean
  ) {}

  async webSocketError(
    ws,
    error
  ) {}
}


// ==========================================================
// WORKER
// ==========================================================

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    if (url.pathname === "/ws") {

      const id =
        env.CHAT.idFromName(
          "public-chat"
        );

      const room =
        env.CHAT.get(id);

      return room.fetch(request);
    }

    if (url.pathname === "/history") {

      const id =
        env.CHAT.idFromName(
          "public-chat"
        );

      const room =
        env.CHAT.get(id);

      return room.fetch(request);
    }

    if (url.pathname === "/health") {

      return Response.json({
        status: "ok",
        service: "ARASH MESSENGER"
      });
    }

    return new Response(
      "ARASH MESSENGER SERVER ONLINE",
      {
        status: 200,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }
};
