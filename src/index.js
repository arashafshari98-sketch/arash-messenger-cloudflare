export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  // ==========================================================
  // HTTP / WEBSOCKET
  // ==========================================================

  async fetch(request) {
    const url = new URL(request.url);

    // --------------------------------------------------------
    // WEBSOCKET
    // --------------------------------------------------------

    if (url.pathname === "/ws") {

      if (
        request.headers.get("Upgrade") !== "websocket"
      ) {
        return new Response(
          "WebSocket required",
          {
            status: 426
          }
        );
      }

      const pair = new WebSocketPair();

      const client = pair[0];
      const server = pair[1];

      // Accept WebSocket using Durable Object Hibernation API.
      this.ctx.acceptWebSocket(server);

      // ------------------------------------------------------
      // Send connection confirmation
      // ------------------------------------------------------

      server.send(
        JSON.stringify({
          type: "connected"
        })
      );

      // ------------------------------------------------------
      // Send saved history
      // ------------------------------------------------------

      try {

        const messages =
          await this.ctx.storage.get("messages") || [];

        for (const message of messages) {

          server.send(
            JSON.stringify({
              type: "history",
              ...message
            })
          );

        }

        // Tell client that history is finished.

        server.send(
          JSON.stringify({
            type: "history_end"
          })
        );

      } catch (error) {

        server.send(
          JSON.stringify({
            type: "error",
            message: "Could not load chat history."
          })
        );
      }

      return new Response(
        null,
        {
          status: 101,
          webSocket: client
        }
      );
    }

    // --------------------------------------------------------
    // HISTORY HTTP ENDPOINT
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

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


  // ==========================================================
  // WEBSOCKET MESSAGE
  // ==========================================================

  async webSocketMessage(ws, message) {

    try {

      const data =
        JSON.parse(message);

      // Only accept chat messages.

      if (
        data.type !== "message"
      ) {
        return;
      }

      const text =
        String(
          data.message || ""
        ).trim();

      if (!text) {
        return;
      }

      // ------------------------------------------------------
      // Load history
      // ------------------------------------------------------

      const messages =
        await this.ctx.storage.get("messages") || [];

      // ------------------------------------------------------
      // Create message
      // ------------------------------------------------------

      const newMessage = {

        // Internal unique message ID.
        id:
          Date.now().toString() +
          "-" +
          Math.random()
            .toString(36)
            .substring(2, 8),

        // Internal client ID.
        // NEVER shown in the UI.
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

      // ------------------------------------------------------
      // Save
      // ------------------------------------------------------

      messages.push(
        newMessage
      );

      // Keep only latest 1000 messages.

      if (
        messages.length > 1000
      ) {

        messages.splice(
          0,
          messages.length - 1000
        );
      }

      await this.ctx.storage.put(
        "messages",
        messages
      );

      // ------------------------------------------------------
      // Broadcast
      // ------------------------------------------------------

      const payload =
        JSON.stringify({
          type: "message",
          ...newMessage
        });

      const sockets =
        this.ctx.getWebSockets();

      for (
        const socket of sockets
      ) {

        try {

          socket.send(
            payload
          );

        } catch (error) {

          // Ignore dead connections.

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

      } catch (e) {
        // Ignore.
      }
    }
  }


  // ==========================================================
  // WEBSOCKET CLOSE
  // ==========================================================

  async webSocketClose(
    ws,
    code,
    reason,
    wasClean
  ) {

    // Nothing required here.
  }


  // ==========================================================
  // WEBSOCKET ERROR
  // ==========================================================

  async webSocketError(
    ws,
    error
  ) {

    // Nothing required here.
  }
}


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(request.url);

    // --------------------------------------------------------
    // PUBLIC CHAT WEBSOCKET
    // --------------------------------------------------------

    if (
      url.pathname === "/ws"
    ) {

      const id =
        env.CHAT.idFromName(
          "public-chat"
        );

      const room =
        env.CHAT.get(id);

      return room.fetch(
        request
      );
    }

    // --------------------------------------------------------
    // PUBLIC CHAT HISTORY
    // --------------------------------------------------------

    if (
      url.pathname === "/history"
    ) {

      const id =
        env.CHAT.idFromName(
          "public-chat"
        );

      const room =
        env.CHAT.get(id);

      return room.fetch(
        request
      );
    }

    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      url.pathname === "/health"
    ) {

      return Response.json({
        status: "ok",
        service: "ARASH MESSENGER"
      });
    }

    // --------------------------------------------------------
    // HOME
    // --------------------------------------------------------

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
