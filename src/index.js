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

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    if (url.pathname === "/history") {
      const messages = await this.ctx.storage.get("messages") || [];

      return Response.json(messages);
    }

    return new Response("ARASH MESSENGER CHAT ROOM ONLINE");
  }

  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);

      if (data.type !== "message") {
        return;
      }

      const messages =
        await this.ctx.storage.get("messages") || [];

      const newMessage = {
        id: Date.now(),
        sender: data.sender || "Someone",
        message: String(data.message || ""),
        time: data.time || new Date().toISOString()
      };

      messages.push(newMessage);

      // فقط آخرین 1000 پیام را نگه می‌داریم
      if (messages.length > 1000) {
        messages.splice(0, messages.length - 1000);
      }

      await this.ctx.storage.put("messages", messages);

      const payload = JSON.stringify({
        type: "message",
        ...newMessage
      });

      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(payload);
        } catch (e) {
          // اتصال خراب است؛ نادیده می‌گیریم
        }
      }

    } catch (e) {
      // پیام نامعتبر
    }
  }

  async webSocketClose(ws) {
    // اتصال بسته شد
  }

  async webSocketError(ws) {
    // خطای اتصال
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.CHAT.idFromName("public-chat");
      const room = env.CHAT.get(id);

      return room.fetch(request);
    }

    if (url.pathname === "/history") {
      const id = env.CHAT.idFromName("public-chat");
      const room = env.CHAT.get(id);

      return room.fetch(request);
    }

    return new Response(
      "ARASH MESSENGER SERVER ONLINE",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }
};
