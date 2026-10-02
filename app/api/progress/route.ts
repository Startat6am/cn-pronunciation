import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const expected = process.env.PROGRESS_ACCESS_KEY;
  const supplied = req.headers.get("x-progress-key") || "";
  if (!expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

async function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not configured in Vercel");
  const sql = neon(url);
  await sql`CREATE TABLE IF NOT EXISTS pronunciation_attempts (
    id BIGSERIAL PRIMARY KEY,
    word TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    phone_score DOUBLE PRECISION,
    tone_score DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS pronunciation_attempts_word_created_idx ON pronunciation_attempts (word, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS pronunciation_best_scores (
    word TEXT PRIMARY KEY,
    score DOUBLE PRECISION NOT NULL,
    phone_score DOUBLE PRECISION,
    tone_score DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  return sql;
}

export async function GET(req: Request) {
  if (!process.env.PROGRESS_ACCESS_KEY) return Response.json({error:"Добавь PROGRESS_ACCESS_KEY в переменные Vercel."},{status:503});
  if (!authorized(req)) return Response.json({error:"Неверный ключ доступа."},{status:401});
  try {
    const sql = await database();
    const rows = await sql`SELECT b.word, b.score, b.phone_score AS "phoneScore", b.tone_score AS "toneScore", b.updated_at AS "updatedAt", COALESCE(a.attempts,0)::int AS attempts, a.last_practice AS "lastPractice" FROM pronunciation_best_scores b LEFT JOIN (SELECT word, COUNT(*) AS attempts, MAX(created_at) AS last_practice FROM pronunciation_attempts GROUP BY word) a ON a.word=b.word ORDER BY b.word`;
    const summary = await sql`SELECT COUNT(DISTINCT word)::int AS "wordsPracticed", COUNT(*)::int AS "totalAttempts", ROUND(AVG(score)::numeric,1)::float AS "averageScore" FROM pronunciation_attempts`;
    return Response.json({ratings:rows,summary:summary[0]});
  } catch (e) {
    return Response.json({error:e instanceof Error?e.message:"Не удалось прочитать статистику."},{status:500});
  }
}

export async function POST(req: Request) {
  if (!process.env.PROGRESS_ACCESS_KEY) return Response.json({error:"Добавь PROGRESS_ACCESS_KEY в переменные Vercel."},{status:503});
  if (!authorized(req)) return Response.json({error:"Неверный ключ доступа."},{status:401});
  try {
    const body = await req.json();
    const word = String(body.word || "").trim();
    const score = Number(body.score);
    const phoneScore = body.phoneScore == null ? null : Number(body.phoneScore);
    const toneScore = body.toneScore == null ? null : Number(body.toneScore);
    if (!word || word.length > 32 || !Number.isFinite(score) || score < 0 || score > 100 ||
      (phoneScore !== null && (!Number.isFinite(phoneScore) || phoneScore < 0 || phoneScore > 100)) ||
      (toneScore !== null && (!Number.isFinite(toneScore) || toneScore < 0 || toneScore > 100))) {
      return Response.json({error:"Некорректные данные оценки."},{status:400});
    }
    const sql = await database();
    await sql`INSERT INTO pronunciation_attempts (word,score,phone_score,tone_score) VALUES (${word},${score},${phoneScore},${toneScore})`;
    const rows = await sql`INSERT INTO pronunciation_best_scores (word,score,phone_score,tone_score) VALUES (${word},${score},${phoneScore},${toneScore}) ON CONFLICT (word) DO UPDATE SET score=EXCLUDED.score, phone_score=EXCLUDED.phone_score, tone_score=EXCLUDED.tone_score, updated_at=NOW() WHERE EXCLUDED.score > pronunciation_best_scores.score RETURNING word,score,phone_score AS "phoneScore",tone_score AS "toneScore",updated_at AS "updatedAt"`;
    const best = rows[0] || (await sql`SELECT word,score,phone_score AS "phoneScore",tone_score AS "toneScore",updated_at AS "updatedAt" FROM pronunciation_best_scores WHERE word=${word}`)[0];
    return Response.json({ok:true,best});
  } catch (e) {
    return Response.json({error:e instanceof Error?e.message:"Не удалось сохранить оценку."},{status:500});
  }
}
