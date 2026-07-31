export const TIME_ROLL_PROGRESS_VERSION = 3;

export type TimeRollRank = "S" | "A" | "B";

export type TimeRollEraProgress = {
  bestScore: number;
  maxCombo: number;
  bestRank: TimeRollRank;
  completed: boolean;
};

export type TimeRollProgress = {
  version: typeof TIME_ROLL_PROGRESS_VERSION;
  bestEra: number;
  bestSize: number;
  totalScore: number;
  eras: Record<string, TimeRollEraProgress>;
  storyEndingSeen: boolean;
  bgmEnabled: boolean;
  sfxEnabled: boolean;
};

export type TimeRollProgressInput = {
  bestEra?: unknown;
  bestSize?: unknown;
  totalScore?: unknown;
  eras?: unknown;
  storyEndingSeen?: unknown;
  soundEnabled?: unknown;
  bgmEnabled?: unknown;
  sfxEnabled?: unknown;
};

export type TimeRollProgressOptions = {
  maxEraIndex?: number;
  defaultSoundEnabled?: boolean;
  defaultBgmEnabled?: boolean;
  defaultSfxEnabled?: boolean;
};

export type TimeRollEraResult = {
  era: number;
  score: number;
  maxCombo: number;
  rank: TimeRollRank;
  completed: boolean;
  size?: number;
  storyEndingSeen?: boolean;
};

const DEFAULT_ERA_PROGRESS: TimeRollEraProgress = {
  bestScore: 0,
  maxCombo: 0,
  bestRank: "B",
  completed: false,
};

const RANK_VALUE: Record<TimeRollRank, number> = {
  B: 1,
  A: 2,
  S: 3,
};

function clampInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return min;

  return Math.max(min, Math.min(max, Math.floor(number)));
}

function nonNegativeNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;

  return Math.max(0, number);
}

function normalizeRank(value: unknown): TimeRollRank {
  return value === "S" || value === "A" || value === "B" ? value : DEFAULT_ERA_PROGRESS.bestRank;
}

function betterRank(current: TimeRollRank, next: TimeRollRank) {
  return RANK_VALUE[next] > RANK_VALUE[current] ? next : current;
}

function safeMaxEraIndex(options: TimeRollProgressOptions) {
  return options.maxEraIndex === undefined
    ? Number.MAX_SAFE_INTEGER
    : clampInteger(options.maxEraIndex, 0);
}

function normalizeEraProgress(value: unknown): TimeRollEraProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_ERA_PROGRESS };
  }

  const candidate = value as Partial<TimeRollEraProgress>;

  return {
    bestScore: nonNegativeNumber(candidate.bestScore),
    maxCombo: clampInteger(candidate.maxCombo, 0),
    bestRank: normalizeRank(candidate.bestRank),
    completed: candidate.completed === true,
  };
}

function normalizeEras(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([era]) => Number.isInteger(Number(era)) && Number(era) >= 0 && String(Number(era)) === era)
      .map(([era, progress]) => [String(Number(era)), normalizeEraProgress(progress)] as const),
  );
}

function totalScoreFromEras(eras: Record<string, TimeRollEraProgress>) {
  return Object.values(eras).reduce((total, era) => total + era.bestScore, 0);
}

function defaultBgmEnabled(options: TimeRollProgressOptions) {
  return options.defaultBgmEnabled ?? options.defaultSoundEnabled ?? true;
}

function defaultSfxEnabled(options: TimeRollProgressOptions) {
  return options.defaultSfxEnabled ?? options.defaultSoundEnabled ?? true;
}

function normalizeProgress(input: TimeRollProgressInput, options: TimeRollProgressOptions = {}): TimeRollProgress {
  const maxEra = safeMaxEraIndex(options);
  const eras = normalizeEras(input.eras);
  const totalScore = totalScoreFromEras(eras);
  const migratedSound = typeof input.soundEnabled === "boolean" ? input.soundEnabled : undefined;

  return {
    version: TIME_ROLL_PROGRESS_VERSION,
    bestEra: clampInteger(input.bestEra, 0, maxEra),
    bestSize: nonNegativeNumber(input.bestSize),
    totalScore: totalScore > 0 ? totalScore : nonNegativeNumber(input.totalScore),
    eras,
    storyEndingSeen: input.storyEndingSeen === true,
    bgmEnabled: typeof input.bgmEnabled === "boolean"
      ? input.bgmEnabled
      : migratedSound ?? defaultBgmEnabled(options),
    sfxEnabled: typeof input.sfxEnabled === "boolean"
      ? input.sfxEnabled
      : migratedSound ?? defaultSfxEnabled(options),
  };
}

export function defaultProgress(options: TimeRollProgressOptions = {}): TimeRollProgress {
  return normalizeProgress({}, options);
}

export function parseProgressJson(raw: string | null | undefined, options: TimeRollProgressOptions = {}): TimeRollProgress {
  if (!raw) return defaultProgress(options);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return defaultProgress(options);
    }

    const candidate = parsed as { version?: unknown } & TimeRollProgressInput;
    if (candidate.version === TIME_ROLL_PROGRESS_VERSION) {
      return normalizeProgress(candidate, options);
    }

    if (candidate.version === 2) {
      return normalizeProgress(candidate, options);
    }

    if (candidate.version === undefined && ("bestEra" in candidate || "bestSize" in candidate)) {
      return normalizeProgress({ bestEra: candidate.bestEra, bestSize: candidate.bestSize }, options);
    }

    return defaultProgress(options);
  } catch {
    return defaultProgress(options);
  }
}

export function serializeProgress(progress: TimeRollProgress) {
  return JSON.stringify(normalizeProgress(progress));
}

export function recordEraResult(progress: TimeRollProgress, result: TimeRollEraResult, options: TimeRollProgressOptions = {}) {
  const normalized = normalizeProgress(progress, options);
  const maxEra = safeMaxEraIndex(options);
  const era = clampInteger(result.era, 0, maxEra);
  const eraKey = String(era);
  const previousEra = normalized.eras[eraKey] ?? DEFAULT_ERA_PROGRESS;
  const nextEraProgress: TimeRollEraProgress = {
    bestScore: Math.max(previousEra.bestScore, nonNegativeNumber(result.score)),
    maxCombo: Math.max(previousEra.maxCombo, clampInteger(result.maxCombo, 0)),
    bestRank: betterRank(previousEra.bestRank, result.rank),
    completed: previousEra.completed || result.completed,
  };
  const eras = {
    ...normalized.eras,
    [eraKey]: nextEraProgress,
  };
  const bestEra = result.completed ? Math.max(normalized.bestEra, Math.min(era + 1, maxEra)) : Math.max(normalized.bestEra, era);

  return {
    ...normalized,
    bestEra,
    bestSize: Math.max(normalized.bestSize, nonNegativeNumber(result.size)),
    totalScore: totalScoreFromEras(eras),
    eras,
    storyEndingSeen: normalized.storyEndingSeen || result.storyEndingSeen === true,
  };
}

export function resetProgress(options: TimeRollProgressOptions = {}): TimeRollProgress {
  return defaultProgress(options);
}
