import crypto from "crypto";
import WebSocket from "ws";
import { XMLParser } from "fast-xml-parser";

export const runtime = "nodejs";

function authUrl(hostUrl: string, key: string, secret: string) {
  const u = new URL(hostUrl);
  const date = new Date().toUTCString();
  const origin = `host: ${u.host}\ndate: ${date}\nGET ${u.pathname} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", secret).update(origin).digest("base64");
  const authorization = Buffer.from(
    `api_key="${key}",algorithm="hmac-sha256",headers="host date request-line",signature="${signature}"`
  ).toString("base64");
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
    const text = String(form.get("text") || "");
    const appId = process.env.IFLYTEK_APP_ID, key = process.env.IFLYTEK_API_KEY, secret = process.env.IFLYTEK_API_SECRET;
    if (!appId || !key || !secret) return Response.json({ error: "iFlytek env is not configured" }, { status: 500 });
    if (!(audio instanceof File) || !text) return Response.json({ error: "audio and text are required" }, { status: 400 });

    const pcm = pcmFromWav(Buffer.from(await audio.arrayBuffer()));
    if (pcm.length < 320) return Response.json({ error: "Recording is too short" }, { status: 400 });
    const endpoint = "wss://ise-api-sg.xf-yun.com/v2/ise";
    const ws = new WebSocket(authUrl(endpoint, key, secret), { handshakeTimeout: 10000 });
    const raw = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("ISE timeout")); }, 30000);
      const parts: string[] = [];
      let settled = false;
      const finish = (err?: Error, value?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (err) reject(err); else resolve(value || "");
      };
      ws.on("message", (message) => {
        try {
          const j = JSON.parse(message.toString());
          if (j.code) { finish(new Error(`iFlytek ISE ${j.code}: ${j.message || "request failed"}`)); ws.close(); return; }
          if (j.data?.data) parts.push(Buffer.from(j.data.data, "base64").toString("utf8"));
          if (j.data?.status === 2) { finish(undefined, parts.join("")); ws.close(); }
        } catch (e) { finish(e instanceof Error ? e : new Error("Invalid ISE response")); ws.close(); }
      });
      ws.on("unexpected-response", (_request, response) => {
        finish(new Error(`iFlytek ISE handshake HTTP ${response.statusCode}`)); ws.close();
      });
      ws.on("error", (e) => finish(e));
      ws.on("open", () => {
        ws.send(JSON.stringify({
          common: { app_id: appId },
          business: {
            sub: "ise", ent: "cn_vip", category: Array.from(text).length === 1 ? "read_syllable" : "read_word",
            cmd: "ssb", auf: "audio/L16;rate=16000", aue: "raw", plev: "0",
            tte: "utf-8", ttp_skip: true,
            result_level: "complete", rstcd: "utf8", rst: "entirety",
            ise_unite: "1", extra_ability: "multi_dimension", text: "\uFEFF" + text
          },
          data: { status: 0, data: "" }
        }));
        const size = 1280;
        for (let i = 0; i < pcm.length; i += size) {
          ws.send(JSON.stringify({
            business: { cmd: "auw", aus: i === 0 ? 1 : (i + size >= pcm.length ? 4 : 2) },
            data: { status: i + size >= pcm.length ? 2 : 1, data: pcm.subarray(i, i + size).toString("base64") }
          }));
        }
      });
    });

    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(raw);
    const findValue = (obj: any, keys: string[]): number | null => {
      if (!obj || typeof obj !== "object") return null;
      for (const key of keys) {
        if (obj[key] !== undefined) {
          const node = obj[key];
          const value = node && typeof node === "object" && node.value !== undefined ? node.value : node;
          const n = Number(value);
          if (Number.isFinite(n)) return n;
        }
      }
      for (const value of Object.values(obj)) {
        const found = findValue(value, keys);
        if (found !== null) return found;
      }
      return null;
    };
    const score = findValue(parsed, ["total_score"]);
    const phoneScore = findValue(parsed, ["phone_score"]);
    const toneScore = findValue(parsed, ["tone_score"]);
    const syllables: Array<{ content: string; dp_message: number | null }> = [];
    const collectSyllables = (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      if (obj.syll !== undefined) {
        const nodes = Array.isArray(obj.syll) ? obj.syll : [obj.syll];
        for (const node of nodes) {
          if (node && typeof node === "object") {
            const dp = Number(node.dp_message);
            syllables.push({
              content: String(node.content ?? ""),
              dp_message: Number.isFinite(dp) ? dp : null
            });
          }
        }
      }
      for (const value of Object.values(obj)) {
        if (value && typeof value === "object") collectSyllables(value);
      }
    };
    collectSyllables(parsed);
    if (score === null) {
      return Response.json({ error: "iFlytek вернул результат без total_score", details: process.env.NODE_ENV === "development" ? raw : undefined }, { status: 502 });
    }
    return Response.json({ score, phoneScore, toneScore, syllables, raw: process.env.NODE_ENV === "development" ? raw : undefined });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Assessment failed" }, { status: 502 });
  }
}
