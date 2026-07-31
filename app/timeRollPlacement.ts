export type PlacementItem = {
  id: number;
  x: number;
  z: number;
  r: number;
  theme?: string;
  objectKind?: number;
  special?: boolean;
};

export type PlacementEra = {
  baseRadius: number;
  arenaUnits: number;
};

export type ProtectedZone = {
  id: string;
  x: number;
  z: number;
  radius: number;
};

export type PlacementOptions = {
  eraIndex: number;
  era: PlacementEra;
  focusTheme?: string;
  seed?: number;
  paddingRatio?: number;
};

export type PlacementPair<T extends PlacementItem = PlacementItem> = {
  a: T;
  b: T;
  clearance: number;
};

export type PlacementIntrusion<T extends PlacementItem = PlacementItem> = {
  item: T;
  zone: ProtectedZone;
  clearance: number;
};

export type PlacementDiagnostics<T extends PlacementItem = PlacementItem> = {
  pairCount: number;
  severePairCount: number;
  setPieceIntrusions: number;
  starterIntrusions: number;
  outOfBounds: number;
  minimumClearance: number;
  worstPairs: PlacementPair<T>[];
  intrusions: PlacementIntrusion<T>[];
};

const MAX_WORST_PAIRS = 8;
const DEFAULT_PADDING_RATIO = 0.12;
const STARTER_TINY_RADIUS_RATIO = 0.14;
const STARTER_CLEAR_RADIUS_RATIO = 2.4;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function itemHash(item: PlacementItem, eraIndex: number, seed: number) {
  let value = (seed >>> 0) ^ Math.imul(eraIndex + 1, 0x9e3779b1) ^ Math.imul(item.id + 17, 0x85ebca6b);
  value ^= Math.imul((item.objectKind ?? 0) + 31, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function orderedByPlacementPriority<T extends PlacementItem>(
  items: readonly T[],
  focusTheme?: string,
) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (!!a.item.special !== !!b.item.special) return a.item.special ? -1 : 1;
      return (
        footprintRadius(b.item, focusTheme) -
          footprintRadius(a.item, focusTheme) ||
        a.index - b.index
      );
    });
}

function arenaHalf(options: PlacementOptions) {
  return options.era.baseRadius * options.era.arenaUnits;
}

function padding(options: PlacementOptions) {
  return options.era.baseRadius * (options.paddingRatio ?? DEFAULT_PADDING_RATIO);
}

function halfDiagonal(width: number, length: number) {
  return Math.hypot(width, length) * 0.5;
}

export function itemRenderScale(item: PlacementItem, focusTheme?: string) {
  const objectKind = Math.abs(Math.floor(item.objectKind ?? 0));
  const valueScale = 1 + (objectKind % 5) * 0.035 + (objectKind >= 5 ? 0.1 : 0);
  const isFocus = !!focusTheme && item.theme === focusTheme;
  return (item.special ? 1.08 : isFocus ? 1.3 : 1.1) * valueScale;
}

export function footprintRadius(item: PlacementItem, focusTheme?: string) {
  const base = Math.max(0, finiteNumber(item.r));
  const isFocus = !!focusTheme && item.theme === focusTheme;
  const visualScale = itemRenderScale(item, focusTheme);
  const silhouetteScale = item.special ? 2.15 : isFocus ? 1.72 : 1.5;
  return base * visualScale * silhouetteScale;
}

export function protectedZonesForEra(options: PlacementOptions): ProtectedZone[] {
  const { baseRadius: base, arenaUnits } = options.era;
  const half = base * arenaUnits;
  const zone = (
    id: string,
    x: number,
    z: number,
    widthRatio: number,
    lengthRatio: number,
    marginRatio: number,
  ): ProtectedZone => ({
    id,
    x,
    z,
    radius: base * (halfDiagonal(widthRatio, lengthRatio) + marginRatio),
  });
  return [
    zone("set-piece", half * 0.31, -half * 0.42, 5.72, 4.66, 0.3),
    zone("hero-station-left", base * -4.2, base * -8.2, 2.8 * 0.82, 2.3 * 0.82, 1.06),
    zone("hero-station-right", base * 4.6, base * -12.4, 2.8 * 0.98, 2.3 * 0.98, 1.17),
    zone("dressing-island-left", -half * 0.29, -half * 0.1, 3.04 * 1.46, 2.52 * 1.46, 0.17),
    zone("dressing-island-right", half * 0.31, -half * 0.13, 3.04 * 1.42, 2.52 * 1.42, 0.17),
    zone("foreground-anchor-left", half * -0.43, half * -0.27, 2.78 * 1.48, 2.34 * 1.48, 0.26),
    zone("foreground-anchor-right", half * 0.48, half * -0.07, 2.78 * 1.28, 2.34 * 1.28, 0.27),
  ];
}

function clearanceFromZone(item: PlacementItem, zone: ProtectedZone, options: PlacementOptions) {
  return Math.hypot(item.x - zone.x, item.z - zone.z) - zone.radius - footprintRadius(item, options.focusTheme) - padding(options);
}

function clearanceFromItem(a: PlacementItem, b: PlacementItem, options: PlacementOptions) {
  return (
    Math.hypot(a.x - b.x, a.z - b.z) -
    footprintRadius(a, options.focusTheme) -
    footprintRadius(b, options.focusTheme) -
    padding(options)
  );
}

function clearanceFromStarter(item: PlacementItem, options: PlacementOptions) {
  if (item.special || item.r <= options.era.baseRadius * STARTER_TINY_RADIUS_RATIO) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    Math.hypot(item.x, item.z) -
    options.era.baseRadius * STARTER_CLEAR_RADIUS_RATIO -
    footprintRadius(item, options.focusTheme) -
    padding(options)
  );
}

function withinArena(item: PlacementItem, options: PlacementOptions) {
  const half = arenaHalf(options);
  const margin = footprintRadius(item, options.focusTheme);
  return (
    item.x >= -half + margin &&
    item.x <= half - margin &&
    item.z >= -half + margin &&
    item.z <= half - margin
  );
}

function clampToArena<T extends PlacementItem>(item: T, options: PlacementOptions): T {
  const half = arenaHalf(options);
  const margin = Math.min(half * 0.45, footprintRadius(item, options.focusTheme));
  return {
    ...item,
    x: clamp(item.x, -half + margin, half - margin),
    z: clamp(item.z, -half + margin, half - margin),
  };
}

function isClear(candidate: PlacementItem, placed: readonly PlacementItem[], zones: readonly ProtectedZone[], options: PlacementOptions) {
  if (!candidate.special && !withinArena(candidate, options)) return false;
  if (clearanceFromStarter(candidate, options) < 0) return false;
  for (const zone of zones) {
    if (clearanceFromZone(candidate, zone, options) < 0) return false;
  }
  for (const item of placed) {
    if (clearanceFromItem(candidate, item, options) < 0) return false;
  }
  return true;
}

function candidateScore(candidate: PlacementItem, placed: readonly PlacementItem[], zones: readonly ProtectedZone[], options: PlacementOptions) {
  let score = candidate.special || withinArena(candidate, options) ? 0 : -10000;
  score = Math.min(score, clearanceFromStarter(candidate, options));
  for (const zone of zones) score = Math.min(score, clearanceFromZone(candidate, zone, options));
  for (const item of placed) score = Math.min(score, clearanceFromItem(candidate, item, options));
  return score;
}

function relocateCandidate<T extends PlacementItem>(
  item: T,
  placed: readonly PlacementItem[],
  zones: readonly ProtectedZone[],
  options: PlacementOptions,
): T {
  if (item.special) return item;
  const base = options.era.baseRadius;
  const original = clampToArena(item, options);
  if (isClear(original, placed, zones, options)) return original;

  const hash = itemHash(item, options.eraIndex, options.seed ?? 0);
  const angleOffset = ((hash % 8192) / 8192) * Math.PI * 2;
  const radialStep = Math.max(base * 0.42, footprintRadius(item, options.focusTheme) * 0.58);
  let best = original;
  let bestScore = candidateScore(original, placed, zones, options);

  for (let attempt = 1; attempt <= 720; attempt += 1) {
    const ring = Math.ceil(Math.sqrt(attempt));
    const angle = attempt * 2.399963229728653 + angleOffset;
    const distance = ring * radialStep;
    const candidate = clampToArena(
      {
        ...item,
        x: item.x + Math.cos(angle) * distance,
        z: item.z + Math.sin(angle) * distance,
      },
      options,
    );
    if (isClear(candidate, placed, zones, options)) return candidate;
    const score = candidateScore(candidate, placed, zones, options);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  const usableRadius = Math.max(
    base,
    arenaHalf(options) - footprintRadius(item, options.focusTheme) - padding(options),
  );
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const progress = (attempt + 0.5) / 1024;
    const angle = attempt * 2.399963229728653 + angleOffset;
    const distance = Math.sqrt(progress) * usableRadius;
    const candidate = clampToArena(
      {
        ...item,
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
      },
      options,
    );
    if (isClear(candidate, placed, zones, options)) return candidate;
    const score = candidateScore(candidate, placed, zones, options);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function diagnosePlacement<T extends PlacementItem>(
  items: readonly T[],
  options: PlacementOptions,
): PlacementDiagnostics<T> {
  const zones = protectedZonesForEra(options);
  const worstPairs: PlacementPair<T>[] = [];
  const intrusions: PlacementIntrusion<T>[] = [];
  let pairCount = 0;
  let severePairCount = 0;
  let starterIntrusions = 0;
  let outOfBounds = 0;
  let minimumClearance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.special && !withinArena(item, options)) outOfBounds += 1;
    const starterClearance = clearanceFromStarter(item, options);
    minimumClearance = Math.min(minimumClearance, starterClearance);
    if (starterClearance < 0) starterIntrusions += 1;
    for (const zone of zones) {
      const clearance = clearanceFromZone(item, zone, options);
      minimumClearance = Math.min(minimumClearance, clearance);
      if (clearance < 0) intrusions.push({ item, zone, clearance });
    }
    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      const other = items[otherIndex];
      const clearance = clearanceFromItem(item, other, options);
      minimumClearance = Math.min(minimumClearance, clearance);
      if (clearance < 0) {
        pairCount += 1;
        const smaller = footprintRadius(item, options.focusTheme) <= footprintRadius(other, options.focusTheme) ? item : other;
        const larger = smaller === item ? other : item;
        const centerDistance = Math.hypot(item.x - other.x, item.z - other.z);
        if (centerDistance + footprintRadius(smaller, options.focusTheme) < footprintRadius(larger, options.focusTheme)) {
          severePairCount += 1;
        }
        worstPairs.push({ a: item, b: other, clearance });
      }
    }
  }

  worstPairs.sort((a, b) => a.clearance - b.clearance);

  return {
    pairCount,
    severePairCount,
    setPieceIntrusions: intrusions.length,
    starterIntrusions,
    outOfBounds,
    minimumClearance: Number.isFinite(minimumClearance) ? minimumClearance : 0,
    worstPairs: worstPairs.slice(0, MAX_WORST_PAIRS),
    intrusions,
  };
}

export function resolveItemSpawnOverlaps<T extends PlacementItem>(
  items: readonly T[],
  options: PlacementOptions,
): T[] {
  const zones = protectedZonesForEra(options);
  const ordered = orderedByPlacementPriority(items, options.focusTheme);
  const resolved = items.map((item) => ({ ...item })) as T[];
  const placed: PlacementItem[] = [];

  for (const { item, index } of ordered) {
    const placedItem = relocateCandidate(item, placed, zones, options);
    resolved[index] = placedItem;
    placed.push(placedItem);
  }

  return resolved;
}
