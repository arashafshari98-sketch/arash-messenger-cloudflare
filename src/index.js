export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // =========================
    // WEBSOCKET
    // =========================
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response(
          "WebSocket required",
          { status: 426 }
        );
      }

      const pair = new WebSocketPair();

      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      // Tell client it is connected
      try {
        server.send(
          JSON.stringify({
            type: "connected"
          })
        );
      } catch (e) {}

      // Send stored history
      try {
        const messages =
          await this.ctx.storage.get("messages") || [];

        for (const message of messages) {
          try {
            server.send(
              JSON.stringify({
                type: "history",
                ...message
              })
            );
          } catch (e) {}
        }

        server.send(
          JSON.stringify({
            type: "history_end"
          })
        );
      } catch (error) {
        try {
          server.send(
            JSON.stringify({
              type: "error",
              message: "Could not load chat history."
            })
          );
        } catch (e) {}
      }

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // =========================
    // HISTORY
    // =========================
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

    // =========================
    // HEALTH
    // =========================
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "ARASH MESSENGER",
        chat: "online"
      });
    }

    return new Response(
      "ARASH MESSENGER CHAT ROOM ONLINE",
      {
        status: 200
      }
    );
  }

  // =========================================================
  // WEBSOCKET MESSAGE
  // =========================================================
  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);

      // =====================================================
      // CHANGE NAME
      // =====================================================
      if (data.type === "set_name") {
        const clientId =
          String(data.client_id || "").trim();

        const name =
          String(data.name || "").trim();

        if (!clientId || !name) {
          return;
        }

        const safeName =
          name.substring(0, 30);

        // Send confirmation to this client
        try {
          ws.send(
            JSON.stringify({
              type: "name_changed",
              client_id: clientId,
              name: safeName
            })
          );
        } catch (e) {}

        // Notify everyone that this user changed name
        const payload =
          JSON.stringify({
            type: "user_name_changed",
            client_id: clientId,
            name: safeName
          });

        const sockets =
          this.ctx.getWebSockets();

        for (const socket of sockets) {
          try {
            socket.send(payload);
          } catch (e) {}
        }

        return;
      }

      // =====================================================
      // DELETE MESSAGE
      // =====================================================
      if (data.type === "delete") {
        const messageId =
          String(data.message_id || "").trim();

        const clientId =
          String(data.client_id || "").trim();

        if (!messageId || !clientId) {
          return;
        }

        const messages =
          await this.ctx.storage.get("messages") || [];

        const target =
          messages.find(
            m => String(m.id) === messageId
          );

        if (!target) {
          return;
        }

        // Only the owner can delete for everyone
        if (
          String(target.client_id || "") !==
          clientId
        ) {
          try {
            ws.send(
              JSON.stringify({
                type: "error",
                message:
                  "You can only delete your own messages."
              })
            );
          } catch (e) {}

          return;
        }

        const filtered =
          messages.filter(
            m => String(m.id) !== messageId
          );

        await this.ctx.storage.put(
          "messages",
          filtered
        );

        const payload =
          JSON.stringify({
            type: "deleted",
            message_id: messageId
          });

        const sockets =
          this.ctx.getWebSockets();

        for (const socket of sockets) {
          try {
            socket.send(payload);
          } catch (e) {}
        }

        return;
      }

      // =====================================================
      // NORMAL MESSAGE
      // =====================================================
      if (data.type !== "message") {
        return;
      }

      const text =
        String(data.message || "").trim();

      if (!text) {
        return;
      }

      const clientId =
        String(data.client_id || "").trim();

      if (!clientId) {
        return;
      }

      // Get user name
      let senderName =
        String(data.sender || "Someone").trim();

      if (!senderName) {
        senderName = "Someone";
      }

      senderName =
        senderName.substring(0, 30);

      // Use client message ID when supplied
      // so the client can match its own message.
      const messageId =
        String(data.message_id || "").trim() ||
        (
          Date.now().toString() +
          "-" +
          Math.random()
            .toString(36)
            .substring(2, 8)
        );

      const messages =
        await this.ctx.storage.get("messages") || [];

      const newMessage = {
        id: messageId,

        client_id: clientId,

        sender: senderName,

        message: text,

        time:
          String(
            data.time ||
            new Date().toISOString()
          )
      };

      messages.push(newMessage);

      // Keep maximum 1000 messages
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

      // Broadcast message to everyone
      const payload =
        JSON.stringify({
          type: "message",
          ...newMessage
        });

      const sockets =
        this.ctx.getWebSockets();

      for (const socket of sockets) {
        try {
          socket.send(payload);
        } catch (e) {
          // Ignore dead connections
        }
      }

    } catch (error) {

      try {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Invalid message."
          })
        );
      } catch (e) {}
    }
  }

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


// =========================================================
// WORKER
// =========================================================

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    // =========================
    // WEBSOCKET
    // =========================
    if (url.pathname === "/ws") {

      const id =
        env.CHAT.idFromName(
          "public-chat"
        );

      const room =
        env.CHAT.get(id);

      return room.fetch(request);
    }

    // =========================
    // HISTORY
    // =========================
    if (url.pathname === "/history") {

      const id =
        env.CHAT.idFromName(
          "public-chat"
        );

      const room =
        env.CHAT.get(id);

      return room.fetch(request);
    }

    // =========================
    // HEALTH
    // =========================
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
