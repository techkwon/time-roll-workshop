import { getD1, type D1DatabaseLike } from "../../../db";
import {
  TIME_ROLL_SCORE_VERSION,
  leaderboardSubmissionMatches,
  validateLeaderboardPayload,
  type LeaderboardEntry,
} from "../../timeRollLeaderboard";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

type D1ResultRow = Record<string, unknown>;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

function unavailable() {
  return json(
    { error: { code: "DB_UNAVAILABLE", message: "순위표를 잠시 사용할 수 없습니다." } },
    { status: 503 }
  );
}

function badRequest(code: string, message: string) {
  return json({ error: { code, message } }, { status: 400 });
}

function entryFromRow(row: D1ResultRow): LeaderboardEntry {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    nickname: String(row.nickname),
    nicknameKey: String(row.nickname_key),
    scoreVersion: Number(row.score_version),
    collectionScore: Number(row.collection_score),
    comboBonus: Number(row.combo_bonus),
    timeBonus: Number(row.time_bonus),
    clearBonus: Number(row.clear_bonus),
    totalScore: Number(row.total_score),
    maxCombo: Number(row.max_combo),
    startedEra: Number(row.started_era),
    reachedEra: Number(row.reached_era),
    completedEras: Number(row.completed_eras),
    victory: Boolean(row.victory),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function limitFromUrl(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = raw === null ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

async function topLeaders(db: D1DatabaseLike, limit: number) {
  const result = await db
    .prepare(
      `SELECT * FROM (
        SELECT
          leaderboard_scores.*,
          ROW_NUMBER() OVER (
            PARTITION BY nickname_key
            ORDER BY completed_eras DESC, total_score DESC, max_combo DESC, created_at ASC, id ASC
          ) AS nickname_rank
        FROM leaderboard_scores
        WHERE score_version = ?
      )
      WHERE nickname_rank = 1
      ORDER BY completed_eras DESC, total_score DESC, max_combo DESC, created_at ASC, id ASC
      LIMIT ?`
    )
    .bind(TIME_ROLL_SCORE_VERSION, limit)
    .all<D1ResultRow>();

  return (result.results ?? []).map(entryFromRow);
}

async function rankForEntry(db: D1DatabaseLike, id: string) {
  const result = await db
    .prepare(
      `SELECT rank FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            ORDER BY completed_eras DESC, total_score DESC, max_combo DESC, created_at ASC, id ASC
          ) AS rank
        FROM (
          SELECT * FROM (
            SELECT
              leaderboard_scores.*,
              ROW_NUMBER() OVER (
                PARTITION BY nickname_key
                ORDER BY completed_eras DESC, total_score DESC, max_combo DESC, created_at ASC, id ASC
              ) AS nickname_rank
            FROM leaderboard_scores
            WHERE score_version = ?
          )
          WHERE nickname_rank = 1
        )
      )
      WHERE id = ?`
    )
    .bind(TIME_ROLL_SCORE_VERSION, id)
    .first<{ rank: number }>();

  return result?.rank ?? null;
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return true;
  }
  return origin === new URL(request.url).origin;
}

async function readJsonBody(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return { ok: false as const, error: { code: "PAYLOAD_TOO_LARGE", message: "제출 데이터가 너무 큽니다." } };
  }

  try {
    return { ok: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false as const, error: { code: "PAYLOAD_INVALID", message: "제출 데이터가 올바르지 않습니다." } };
  }
}

async function currentEntryForRun(db: D1DatabaseLike, runId: string) {
  const row = await db
    .prepare("SELECT * FROM leaderboard_scores WHERE run_id = ?")
    .bind(runId)
    .first<D1ResultRow>();

  return row ? entryFromRow(row) : null;
}

function newId() {
  return crypto.randomUUID();
}

export async function GET(request: Request) {
  try {
    const db = getD1();
    return json({ leaders: await topLeaders(db, limitFromUrl(request)) });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return json(
        { error: { code: "ORIGIN_FORBIDDEN", message: "허용되지 않은 제출입니다." } },
        { status: 403 }
      );
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return badRequest(body.error.code, body.error.message);
    }

    const validated = validateLeaderboardPayload(body.value);
    if (!validated.ok) {
      return badRequest(validated.error.code, validated.error.message);
    }

    const db = getD1();
    const insertResult = await db
      .prepare(
        `INSERT OR IGNORE INTO leaderboard_scores (
          id, run_id, nickname, nickname_key, collection_score, combo_bonus,
          time_bonus, clear_bonus, total_score, max_combo, started_era, reached_era,
          completed_eras, victory, score_version, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(
        newId(),
        validated.payload.runId,
        validated.payload.nickname,
        validated.nicknameKey,
        validated.payload.collectionScore,
        validated.payload.comboBonus,
        validated.payload.timeBonus,
        validated.payload.clearBonus,
        validated.payload.totalScore,
        validated.payload.maxCombo,
        validated.payload.startedEra,
        validated.payload.reachedEra,
        validated.payload.completedEras,
        validated.payload.victory ? 1 : 0,
        validated.payload.scoreVersion
      )
      .run();

    const entry = await currentEntryForRun(db, validated.payload.runId);
    if (!entry) {
      return unavailable();
    }
    if (!leaderboardSubmissionMatches(entry, validated.payload, validated.nicknameKey)) {
      return json(
        {
          error: {
            code: "RUN_CONFLICT",
            message: "이미 다른 기록으로 제출된 실행 ID입니다.",
          },
        },
        { status: 409 }
      );
    }

    const leaders = await topLeaders(db, DEFAULT_LIMIT);
    const created = Number(insertResult.meta?.changes ?? 0) > 0;
    return json(
      { entry, rank: await rankForEntry(db, entry.id), leaders },
      { status: created ? 201 : 200 }
    );
  } catch {
    return unavailable();
  }
}
