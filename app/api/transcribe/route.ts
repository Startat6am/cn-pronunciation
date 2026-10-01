import crypto from "crypto";
import WebSocket from "ws";

export const runtime = "nodejs";

function authUrl(hostUrl: string, key: string, secret: string) {
  const u = new URL(hostUrl);
  const date = new Date().toUTCString();
  const origin = `host: ${u.host}\ndate: ${date}\nGET ${u.pathname} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", secret).update(origin).digest("base64");
  const authorization = Buffer.from(`api_key="${key}",algorithm="hmac-sha256",headers="host date request-line",signature="${signature}"`).toString("base64");
  return `${hostUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(u.host)}`;
}

function pcmFromWav(b: Buffer) {
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return b;
  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === "data") return b.subarray(p + 8, p + 8 + n);
    p += 8 + n;
  }
  throw new Error("Invalid WAV");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    const appId = process.env.IFLYTEK_APP_ID, key = process.env.IFLYTEK_IAT_API_KEY || process.env.IFLYTEK_API_KEY, secret = process.env.IFLYTEK_IAT_API_SECRET || process.env.IFLYTEK_API_SECRET;
    if (!appId || !key || !secret) return Response.json({ error: "iFlytek env is not configured" }, { status: 500 });
    if (!(audio instanceof File)) return Response.json({ error: "audio is required" }, { status: 400 });
    const pcm = pcmFromWav(Buffer.from(await audio.arrayBuffer()));
    if (pcm.length < 320) return Response.json({ error: "Recording is too short" }, { status: 400 });
    if (pcm.length > 16000 * 2 * 60) return Response.json({ error: "Recording exceeds the 60-second recognition limit" }, { status: 400 });

    const endpoint = "wss://iat-api-sg.xf-yun.com/v2/iat";
    const ws = new WebSocket(authUrl(endpoint, key, secret), { handshakeTimeout: 10000 });
    const transcript = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("iFlytek ASR timeout")); }, 25000);
      let settled = false;
      const parts = new Map<number, string>();
      const finish = (err?: Error, value?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (err) reject(err); else resolve(value || "");
      };
      ws.on("message", (message) => {
        try {
          const j = JSON.parse(message.toString());
          if (j.code && j.code !== 0) { finish(new Error(`iFlytek ASR ${j.code}: ${j.message || "request failed"}`)); ws.close(); return; }
          const result = j.data?.result;
          if (result) {
            const text = (result.ws || []).map((segment: any) => (segment.cw || []).map((candidate: any) => candidate.w || "").join("")).join("");
            if (text) parts.set(Number(result.sn ?? parts.size), text);
          }
          if (j.data?.status === 2) {
            finish(undefined, [...parts.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]).join(""));
            ws.close();
          }
        } catch (e) { finish(e instanceof Error ? e : new Error("Invalid ASR response")); ws.close(); }
      });
      ws.on("unexpected-response", (_request, response) => { finish(new Error(`iFlytek ASR handshake HTTP ${response.statusCode}`)); ws.close(); });
      ws.on("error", (e) => finish(e));
      ws.on("open", () => {
        const size = 1280;
        const frames: Buffer[] = [];
        for (let i = 0; i < pcm.length; i += size) frames.push(pcm.subarray(i, Math.min(i + size, pcm.length)));
        const sendFrame = (index: number) => {
          if (settled) return;
          if (index >= frames.length) {
            ws.send(JSON.stringify({ data: { status: 2 } }));
            return;
          }
          const frame = frames[index];
          ws.send(JSON.stringify({
            ...(index === 0 ? {
              common: { app_id: appId },
              business: { language: "zh_cn", domain: "iat", accent: "mandarin", vad_eos: 1200, ptt: 1 }
            } : {}),
            data: { status: index === 0 ? 0 : 1, format: "audio/L16;rate=16000", encoding: "raw", audio: frame.toString("base64") }
          }));
          setTimeout(() => sendFrame(index + 1), 40);
        };
        sendFrame(0);
      });
    });
    return Response.json({ transcript });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Transcription failed" }, { status: 502 });
  }
}
