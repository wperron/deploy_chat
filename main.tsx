import {
  generateUUID,
  getCookies,
  h,
  jsx,
  serve,
  serveStatic,
  setCookie,
} from "./deps.ts";
import { Message } from "./types.ts";

serve({
  "/": (req) => {
    const user = getUser(req);
    if (user !== undefined) {
      return jsx(<Main user={user} />);
    } else {
      return jsx(<Signin />);
    }
  },
  "/signin": async (req) => {
    const formdata = await req.formData();
    const name = formdata.get("name");
    if (typeof name !== "string") {
      return new Response("name is not valid");
    }
    const headers = new Headers({ location: "/" });
    setCookie({ headers }, { name: "user", value: name });
    return new Response("", { headers, status: 303 });
  },
  "/send": send,
  "/listen": listen,
});

function Main(props: { user: string }) {
  return (
    <html>
      <head>
        <title>Deno Chat</title>
        <script src="/ui.bundle.js" type="module"></script>
      </head>
      <body>
        <header>
          <h3>Deno Chat</h3>
          <p>Signed in as {props.user}</p>
          <p>
            Status: <span id="status">🔴 Disconnected</span>
          </p>
        </header>
        <form id="form">
          <input type="text" id="message" />
          <button type="submit">Send</button>
        </form>
        <ul id="messages"></ul>
      </body>
    </html>
  );
}

function Signin() {
  return (
    <html>
      <head>
        <title>Deno Chat</title>
        <script src="/ui.bundle.js" type="module"></script>
      </head>
      <body>
        <header>
          <h3>Deno Chat</h3>
          <p>Not yet signed in. Please enter your name below and submit.</p>
        </header>
        <form action="/signin" method="POST">
          <input type="text" id="name" name="name" />
          <button type="submit">Join</button>
        </form>
      </body>
    </html>
  );
}

function getUser(req: Request): string | undefined {
  const cookies = getCookies(req);
  const user = cookies.user;
  if (typeof user !== "string") {
    return undefined;
  }
  return user;
}

const lastMessageTimestampPerIP = new Map<string, Date>();

async function send(req: Request): Promise<Response> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const lastMessageTimestamp = lastMessageTimestampPerIP.get(ip);
  const now = new Date();
  if (
    lastMessageTimestamp &&
    (lastMessageTimestamp.getTime() + 1000 > now.getTime())
  ) {
    return new Response("max 1 message per second per IP!", { status: 400 });
  }
  lastMessageTimestampPerIP.set(ip, now);

  if (req.method === "POST") {
    const user = getUser(req);
    if (user === undefined) {
      return new Response("not signed in", { status: 400 });
    }

    const msg = await req.json();
    const body = msg["body"];
    if (typeof body !== "string") {
      return new Response("invalid body", { status: 400 });
    }

    const channel = new BroadcastChannel("chat");

    const message: Message = {
      id: generateUUID(),
      ts: new Date().toISOString(),
      user,
      body,
    };

    channel.postMessage(message);
    channel.close();

    return new Response("sent message");
  } else {
    return new Response("method not accepted", { status: 405 });
  }
}

function listen(_req: Request): Response {
  const channel = new BroadcastChannel("chat");
  let intervalId: number | null = null;
  const stream = new ReadableStream({
    start: (controller) => {
      keepalive(controller);
      intervalId = setInterval(() => {
        keepalive(controller);
      }, 1000);
      channel.onmessage = (e) => {
        send(controller, { kind: "msg", data: e.data });
      };
    },
    cancel() {
      channel.close();
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    },
  });

  function keepalive(controller: ReadableStreamController<Uint8Array>) {
    send(controller, { kind: "keepalive" });
  }

  function send(
    controller: ReadableStreamController<Uint8Array>,
    body: unknown,
  ) {
    const msg = JSON.stringify(body) + "\n";
    const chunk = new TextEncoder().encode(msg);
    controller.enqueue(chunk);
  }

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson" },
  });
}
