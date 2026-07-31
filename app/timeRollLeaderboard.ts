export const TIME_ROLL_SCORE_VERSION = 1;

export type ScoreBreakdown = {
  collectionScore: number;
  comboBonus: number;
  timeBonus: number;
  clearBonus: number;
  totalScore: number;
};

export type LeaderboardSubmitPayload = ScoreBreakdown & {
  runId: string;
  nickname: string;
  scoreVersion: number;
  maxCombo: number;
  startedEra: number;
  reachedEra: number;
  completedEras: number;
  victory: boolean;
};

export type LeaderboardEntry = LeaderboardSubmitPayload & {
  id: string;
  nicknameKey: string;
  createdAt: string;
  updatedAt: string;
};

export type LeaderboardResponse = {
  entry: LeaderboardEntry;
  rank: number | null;
  leaders: LeaderboardEntry[];
};

export type LeaderboardValidationErrorCode =
  | "RUN_ID_REQUIRED"
  | "NICKNAME_LENGTH"
  | "NICKNAME_CHARACTERS"
  | "NICKNAME_PROFANITY"
  | "NICKNAME_PII"
  | "SCORE_VERSION"
  | "SCORE_INTEGER"
  | "SCORE_SUM"
  | "CLEAR_BONUS"
  | "TIME_BONUS"
  | "SCORE_CAP"
  | "MAX_COMBO"
  | "ERA_RANGE"
  | "VICTORY_CONSTRAINT"
  | "RUN_CONFLICT"
  | "PAYLOAD_INVALID";

export type LeaderboardValidationError = {
  code: LeaderboardValidationErrorCode;
  message: string;
};

export type LeaderboardValidationResult =
  | { ok: true; payload: LeaderboardSubmitPayload; nicknameKey: string }
  | { ok: false; error: LeaderboardValidationError };

const ERROR_MESSAGES: Record<LeaderboardValidationErrorCode, string> = {
  RUN_ID_REQUIRED: "실행 ID가 올바르지 않습니다.",
  NICKNAME_LENGTH: "별명은 2~8글자로 입력해 주세요.",
  NICKNAME_CHARACTERS: "별명은 한글, 영문, 숫자만 사용할 수 있습니다.",
  NICKNAME_PROFANITY: "사용할 수 없는 별명입니다.",
  NICKNAME_PII: "개인정보나 학교·학급 정보는 별명에 넣을 수 없습니다.",
  SCORE_VERSION: "점수 버전이 올바르지 않습니다.",
  SCORE_INTEGER: "점수 값이 올바르지 않습니다.",
  SCORE_SUM: "점수 합계가 올바르지 않습니다.",
  CLEAR_BONUS: "클리어 보너스가 올바르지 않습니다.",
  TIME_BONUS: "시간 보너스가 올바르지 않습니다.",
  SCORE_CAP: "점수 값이 허용 범위를 넘었습니다.",
  MAX_COMBO: "콤보 값이 올바르지 않습니다.",
  ERA_RANGE: "시대 진행 값이 올바르지 않습니다.",
  VICTORY_CONSTRAINT: "승리 기록이 올바르지 않습니다.",
  RUN_CONFLICT: "이미 다른 기록으로 제출된 실행 ID입니다.",
  PAYLOAD_INVALID: "제출 데이터가 올바르지 않습니다.",
};

const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{16,80}$/;
const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9]+$/u;
const PROFANITY_PATTERNS = [
  /시발/u,
  /씨발/u,
  /병신/u,
  /개새/u,
  /좆/u,
  /fuck/i,
  /shit/i,
  /bitch/i,
];
const PII_PATTERNS = [
  /^\d+$/u,
  /\d{7,}/u,
  /학교/u,
  /초등/u,
  /중학/u,
  /고등/u,
  /학년/u,
  /\d반/u,
  /[가-힣]{2,4}\d{2,}/u,
];
const PAYLOAD_FIELDS = new Set([
  "runId",
  "nickname",
  "scoreVersion",
  "collectionScore",
  "comboBonus",
  "timeBonus",
  "clearBonus",
  "totalScore",
  "maxCombo",
  "startedEra",
  "reachedEra",
  "completedEras",
  "victory",
]);

function error(code: LeaderboardValidationErrorCode): LeaderboardValidationResult {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function normalizeNickname(nickname: string) {
  return nickname.trim().normalize("NFC");
}

export function nicknameKeyFor(nickname: string) {
  return normalizeNickname(nickname).toLocaleLowerCase("ko-KR");
}

export function validateNickname(nickname: unknown): LeaderboardValidationResult {
  if (typeof nickname !== "string") {
    return error("NICKNAME_LENGTH");
  }

  const normalized = normalizeNickname(nickname);
  const length = Array.from(normalized).length;
  if (length < 2 || length > 8) {
    return error("NICKNAME_LENGTH");
  }
  if (!NICKNAME_PATTERN.test(normalized)) {
    return error("NICKNAME_CHARACTERS");
  }
  if (PROFANITY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return error("NICKNAME_PROFANITY");
  }
  if (PII_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return error("NICKNAME_PII");
  }

  return {
    ok: true,
    payload: {
      runId: "",
      nickname: normalized,
      scoreVersion: TIME_ROLL_SCORE_VERSION,
      collectionScore: 0,
      comboBonus: 0,
      timeBonus: 0,
      clearBonus: 0,
      totalScore: 0,
      maxCombo: 0,
      startedEra: 1,
      reachedEra: 1,
      completedEras: 0,
      victory: false,
    },
    nicknameKey: nicknameKeyFor(normalized),
  };
}

export function validateLeaderboardPayload(
  value: unknown
): LeaderboardValidationResult {
  if (!isRecord(value)) {
    return error("PAYLOAD_INVALID");
  }
  if (Object.keys(value).some((field) => !PAYLOAD_FIELDS.has(field))) {
    return error("PAYLOAD_INVALID");
  }

  if (typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) {
    return error("RUN_ID_REQUIRED");
  }

  const nicknameResult = validateNickname(value.nickname);
  if (!nicknameResult.ok) {
    return nicknameResult;
  }

  if (value.scoreVersion !== TIME_ROLL_SCORE_VERSION) {
    return error("SCORE_VERSION");
  }

  const integerFields = [
    "collectionScore",
    "comboBonus",
    "timeBonus",
    "clearBonus",
    "totalScore",
    "maxCombo",
    "startedEra",
    "reachedEra",
    "completedEras",
  ] as const;

  if (integerFields.some((field) => !isNonnegativeInteger(value[field]))) {
    return error("SCORE_INTEGER");
  }
  if (typeof value.victory !== "boolean") {
    return error("PAYLOAD_INVALID");
  }

  const payload: LeaderboardSubmitPayload = {
    runId: value.runId,
    nickname: nicknameResult.payload.nickname,
    scoreVersion: value.scoreVersion,
    collectionScore: Number(value.collectionScore),
    comboBonus: Number(value.comboBonus),
    timeBonus: Number(value.timeBonus),
    clearBonus: Number(value.clearBonus),
    totalScore: Number(value.totalScore),
    maxCombo: Number(value.maxCombo),
    startedEra: Number(value.startedEra),
    reachedEra: Number(value.reachedEra),
    completedEras: Number(value.completedEras),
    victory: value.victory,
  };

  if (
    payload.startedEra < 1 ||
    payload.startedEra > 5 ||
    payload.reachedEra < 1 ||
    payload.reachedEra > 5 ||
    payload.completedEras > 5
  ) {
    return error("ERA_RANGE");
  }
  const maxCompletableEras = 6 - payload.startedEra;
  if (
    payload.reachedEra < payload.startedEra ||
    payload.completedEras > maxCompletableEras
  ) {
    return error("ERA_RANGE");
  }
  if (
    payload.victory &&
    (payload.reachedEra !== 5 || payload.completedEras !== maxCompletableEras)
  ) {
    return error("VICTORY_CONSTRAINT");
  }
  const expectedCompletedEras = payload.victory
    ? maxCompletableEras
    : Math.max(0, payload.reachedEra - payload.startedEra);
  if (payload.completedEras !== expectedCompletedEras) {
    return error("ERA_RANGE");
  }
  if (payload.collectionScore + payload.comboBonus + payload.timeBonus + payload.clearBonus !== payload.totalScore) {
    return error("SCORE_SUM");
  }
  if (payload.clearBonus !== 1600 * payload.completedEras) {
    return error("CLEAR_BONUS");
  }
  if (payload.timeBonus % 20 !== 0 || payload.timeBonus > 2000 * payload.completedEras) {
    return error("TIME_BONUS");
  }
  if (
    payload.collectionScore >
      150000 * Math.max(1, payload.completedEras + (payload.victory ? 0 : 1)) ||
    payload.comboBonus >
      150000 * Math.max(1, payload.completedEras + (payload.victory ? 0 : 1))
  ) {
    return error("SCORE_CAP");
  }
  if (payload.maxCombo > 200) {
    return error("MAX_COMBO");
  }
  return { ok: true, payload, nicknameKey: nicknameResult.nicknameKey };
}

export function leaderboardSubmissionMatches(
  entry: Pick<
    LeaderboardEntry,
    | "runId"
    | "nickname"
    | "nicknameKey"
    | "scoreVersion"
    | "collectionScore"
    | "comboBonus"
    | "timeBonus"
    | "clearBonus"
    | "totalScore"
    | "maxCombo"
    | "startedEra"
    | "reachedEra"
    | "completedEras"
    | "victory"
  >,
  payload: LeaderboardSubmitPayload,
  nicknameKey: string
) {
  return (
    entry.runId === payload.runId &&
    entry.nickname === payload.nickname &&
    entry.nicknameKey === nicknameKey &&
    entry.scoreVersion === payload.scoreVersion &&
    entry.collectionScore === payload.collectionScore &&
    entry.comboBonus === payload.comboBonus &&
    entry.timeBonus === payload.timeBonus &&
    entry.clearBonus === payload.clearBonus &&
    entry.totalScore === payload.totalScore &&
    entry.maxCombo === payload.maxCombo &&
    entry.startedEra === payload.startedEra &&
    entry.reachedEra === payload.reachedEra &&
    entry.completedEras === payload.completedEras &&
    entry.victory === payload.victory
  );
}

export const PENDING_LEADERBOARD_KEY = "time-roll-pending-leaderboard-v1";
const MAX_PENDING_SUBMISSIONS = 3;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadPendingLeaderboardSubmissions(
  storage: StorageLike,
): LeaderboardSubmitPayload[] {
  try {
    const raw = storage.getItem(PENDING_LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => validateLeaderboardPayload(value))
      .filter((result) => result.ok)
      .map((result) => result.payload)
      .slice(-MAX_PENDING_SUBMISSIONS);
  } catch {
    return [];
  }
}

function writePendingLeaderboardSubmissions(
  storage: StorageLike,
  submissions: LeaderboardSubmitPayload[],
) {
  try {
    if (submissions.length === 0) {
      storage.removeItem(PENDING_LEADERBOARD_KEY);
      return true;
    }
    storage.setItem(
      PENDING_LEADERBOARD_KEY,
      JSON.stringify(submissions.slice(-MAX_PENDING_SUBMISSIONS)),
    );
    return true;
  } catch {
    return false;
  }
}

export function enqueuePendingLeaderboardSubmission(
  storage: StorageLike,
  payload: LeaderboardSubmitPayload,
) {
  const validated = validateLeaderboardPayload(payload);
  if (!validated.ok) return false;
  const next = loadPendingLeaderboardSubmissions(storage).filter(
    (entry) => entry.runId !== validated.payload.runId,
  );
  next.push(validated.payload);
  return writePendingLeaderboardSubmissions(storage, next);
}

export function removePendingLeaderboardSubmission(
  storage: StorageLike,
  runId: string,
) {
  const next = loadPendingLeaderboardSubmissions(storage).filter(
    (entry) => entry.runId !== runId,
  );
  writePendingLeaderboardSubmissions(storage, next);
}
