export const TIME_ROLL_SCORE_VERSION = 1;

export type PickupScoreInput = {
  sizeRatio: number;
  isFocus: boolean;
  special: boolean;
  combo: number;
};

export type PickupScore = {
  collectionScore: number;
  comboBonus: number;
  clearBonus: number;
  totalScore: number;
};

export type ScoreBreakdown = {
  collectionScore: number;
  comboBonus: number;
  timeBonus: number;
  clearBonus: number;
  totalScore: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function calculatePickupScore(input: PickupScoreInput): PickupScore {
  const collectionScore = Math.round(input.sizeRatio * 900) + (input.isFocus ? 120 : 45);
  const comboMultiplier = clamp(Math.floor(input.combo), 0, 8);
  const comboBonus = Math.round(collectionScore * comboMultiplier * 0.12);
  const clearBonus = input.special ? 1600 : 0;

  return {
    collectionScore,
    comboBonus,
    clearBonus,
    totalScore: collectionScore + comboBonus + clearBonus,
  };
}

export function timeBonusFor(seconds: number) {
  return Math.ceil(clamp(seconds, 0, 100)) * 20;
}

export const calculateTimeBonus = timeBonusFor;

export function totalScoreForBreakdown(
  breakdown: Omit<ScoreBreakdown, "totalScore">
) {
  return (
    breakdown.collectionScore +
    breakdown.comboBonus +
    breakdown.timeBonus +
    breakdown.clearBonus
  );
}

export function createScoreBreakdown(
  input: Partial<Omit<ScoreBreakdown, "totalScore">> = {}
): ScoreBreakdown {
  const base = {
    collectionScore: input.collectionScore ?? 0,
    comboBonus: input.comboBonus ?? 0,
    timeBonus: input.timeBonus ?? 0,
    clearBonus: input.clearBonus ?? 0,
  };

  return {
    ...base,
    totalScore: totalScoreForBreakdown(base),
  };
}

export function mergeScoreBreakdowns(
  ...breakdowns: ReadonlyArray<Readonly<ScoreBreakdown>>
): ScoreBreakdown {
  return createScoreBreakdown(
    breakdowns.reduce(
      (total, breakdown) => ({
        collectionScore: total.collectionScore + breakdown.collectionScore,
        comboBonus: total.comboBonus + breakdown.comboBonus,
        timeBonus: total.timeBonus + breakdown.timeBonus,
        clearBonus: total.clearBonus + breakdown.clearBonus,
      }),
      {
        collectionScore: 0,
        comboBonus: 0,
        timeBonus: 0,
        clearBonus: 0,
      }
    )
  );
}
