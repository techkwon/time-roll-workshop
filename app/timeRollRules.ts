export const COLLECT_RATIO = 0.82;
export const START_RADIUS_RATIO = 0.18;
export const BOSS_RADIUS_RATIO = 0.7;
export const TARGET_RADIUS_RATIO = 0.86;

export type GrowthTierId = "tiny" | "small" | "medium" | "large" | "monument";

export type RadiusLike = number | {
  radius?: number;
  r?: number;
  special?: boolean;
};

export type GrowthTier = {
  id: GrowthTierId;
  thresholdRatio: number;
  itemRadiusRangeRatio: readonly [number, number];
  labelKo: string;
};

export const GROWTH_TIERS: readonly GrowthTier[] = [
  {
    id: "tiny",
    thresholdRatio: START_RADIUS_RATIO,
    itemRadiusRangeRatio: [0.06, 0.14],
    labelKo: "손안 물건",
  },
  {
    id: "small",
    thresholdRatio: 0.27,
    itemRadiusRangeRatio: [0.15, 0.26],
    labelKo: "책상 위 물건",
  },
  {
    id: "medium",
    thresholdRatio: 0.42,
    itemRadiusRangeRatio: [0.27, 0.42],
    labelKo: "교실 물건",
  },
  {
    id: "large",
    thresholdRatio: 0.62,
    itemRadiusRangeRatio: [0.43, 0.57],
    labelKo: "건물만 한 물건",
  },
  {
    id: "monument",
    thresholdRatio: TARGET_RADIUS_RATIO,
    itemRadiusRangeRatio: [0.58, BOSS_RADIUS_RATIO],
    labelKo: "시대 상징물",
  },
] as const;

export const TIERS = Object.fromEntries(
  GROWTH_TIERS.map((tier) => [tier.id, tier]),
) as Record<GrowthTierId, GrowthTier>;

const ERA_SIZE_SCALES = [0.55, 2.2, 11, 48, 170] as const;
const ABSORB_VOLUME_RATIO = 0.72;

function radiusOf(value: RadiusLike) {
  return typeof value === "number" ? value : (value.radius ?? value.r ?? 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function startingRadius(base: number) {
  return Math.max(0, base) * START_RADIUS_RATIO;
}

export function requiredPlayerRadius(item: RadiusLike) {
  return radiusOf(item) / COLLECT_RATIO;
}

export function canCollect(player: RadiusLike, item: RadiusLike, specialReady: boolean) {
  if (typeof item !== "number" && item.special && !specialReady) return false;

  return radiusOf(item) <= radiusOf(player) * COLLECT_RATIO;
}

export function absorbRadius(current: RadiusLike, item: RadiusLike, focusOrSpecial = 1) {
  const currentRadius = Math.max(0, radiusOf(current));
  const itemRadius = Math.max(0, radiusOf(item));
  const multiplier = Math.max(0, focusOrSpecial);
  const volume = currentRadius ** 3 + itemRadius ** 3 * ABSORB_VOLUME_RATIO * multiplier;

  return Math.cbrt(volume);
}

export function growthRatio(radius: RadiusLike, base: number) {
  if (base <= 0) return 0;

  return radiusOf(radius) / base;
}

export function growthTier(radius: RadiusLike, base: number) {
  const ratio = growthRatio(radius, base);
  let current = GROWTH_TIERS[0];

  for (const tier of GROWTH_TIERS) {
    if (ratio >= tier.thresholdRatio) current = tier;
  }

  return current;
}

export function nextTier(radius: RadiusLike, base: number) {
  const current = growthTier(radius, base);
  const index = GROWTH_TIERS.findIndex((tier) => tier.id === current.id);

  return GROWTH_TIERS[index + 1] ?? null;
}

export function formatPhysicalSize(radius: RadiusLike, eraIndex: number) {
  const scale = ERA_SIZE_SCALES[clamp(Math.trunc(eraIndex), 0, ERA_SIZE_SCALES.length - 1)];
  const meters = Math.max(0, radiusOf(radius)) * scale;

  if (meters < 1) return `약 ${Math.round(meters * 100)} cm`;
  if (meters < 1000) return `약 ${meters.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} m`;

  return `약 ${(meters / 1000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} km`;
}
