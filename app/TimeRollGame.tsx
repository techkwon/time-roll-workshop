"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOSS_RADIUS_RATIO,
  GROWTH_TIERS,
  absorbRadius,
  canCollect as canCollectByRule,
  formatPhysicalSize,
  growthRatio as getGrowthRatio,
  growthTier as getGrowthTier,
  nextTier as getNextTier,
  requiredPlayerRadius,
  startingRadius,
  type GrowthTierId,
} from "./timeRollRules";
import {
  TIME_ROLL_ENDING,
  TIME_ROLL_ERA_STORIES,
  TIME_ROLL_INTRO_TEASER,
  TIME_ROLL_PROTAGONIST,
  getTimeRollEraStory,
} from "./timeRollStory";
import {
  defaultProgress,
  parseProgressJson,
  recordEraResult,
  serializeProgress,
  type TimeRollProgressV2,
} from "./timeRollProgress";
import {
  makeCapsule,
  makeDish,
  makeRoundedBox,
  makeTorus,
  makeTruss,
  makeWheel,
} from "./timeRollPremiumMeshes";
import { KENNEY_FACTORY_MESHES } from "./timeRollCc0Meshes";
import { robotMeshYaw, segmentTransform } from "./timeRollVisualMath";

type ThemeId = "manufacturing" | "construction" | "transport" | "communication" | "life";
type GameMode = "intro" | "playing" | "paused" | "eraClear" | "victory" | "timeUp";
type MeshName =
  | "cube"
  | "sphere"
  | "cylinder"
  | "cone"
  | "plane"
  | "roundedBox"
  | "capsule"
  | "torus"
  | "dish"
  | "truss"
  | "wheel"
  | "kenneyCog"
  | "kenneyConveyor"
  | "kenneyScanner"
  | "kenneyScreen"
  | "kenneyCarWheel"
  | "kenneyCarCone"
  | "kenneyTreeOak"
  | "kenneyMushroomRed";

type Era = {
  name: string;
  shortName: string;
  year: string;
  focus: ThemeId;
  mission: string;
  baseRadius: number;
  arenaUnits: number;
  seconds: number;
  goal: number;
  ground: [number, number, number];
  sky: [number, number, number];
};

type Theme = {
  id: ThemeId;
  label: string;
  icon: string;
  color: [number, number, number];
};

type Collectible = {
  id: number;
  name: string;
  theme: ThemeId;
  era: number;
  x: number;
  z: number;
  r: number;
  yaw: number;
  shape: MeshName;
  objectKind: number;
  decalTile: number;
  collected: boolean;
  special?: boolean;
};

type Attachment = {
  theme: ThemeId;
  seed: number;
  shape: MeshName;
  objectKind: number;
  decalTile: number;
};

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: [number, number, number];
};

type GameState = {
  mode: GameMode;
  era: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  rollX: number;
  rollZ: number;
  timer: number;
  boost: number;
  items: Collectible[];
  attachments: Attachment[];
  particles: Particle[];
  themeTotals: Record<ThemeId, number>;
  eraCollected: number;
  totalCollected: number;
  collectedLabel: string;
  message: string;
  messageTime: number;
  bumpCooldown: number;
  shake: number;
  cameraKick: number;
  seed: number;
  reducedMotion: boolean;
  lowQuality: boolean;
  bossReady: boolean;
  finalReady: boolean;
  growthTier: GrowthTierId;
  growthRatio: number;
  nextUnlockRatio: number | null;
  score: number;
  combo: number;
  maxCombo: number;
  eraScore: number;
  comboTimer: number;
  lastCollection: string;
  blockedCollision: string;
};

type HudSnapshot = {
  mode: GameMode;
  era: number;
  timer: number;
  radius: number;
  boost: number;
  themeTotals: Record<ThemeId, number>;
  eraCollected: number;
  totalCollected: number;
  collectedLabel: string;
  message: string;
  nearbyName: string;
  nearbyCanCollect: boolean;
  bossReady: boolean;
  finalReady: boolean;
  growthTier: GrowthTierId;
  growthTierLabel: string;
  growthRatio: number;
  nextUnlockRatio: number | null;
  nextCollectSize: string;
  bossName: string;
  bossCollected: boolean;
  score: number;
  combo: number;
  maxCombo: number;
  eraScore: number;
  lastCollection: string;
  blockedCollision: string;
  bestEra: number;
  bestSize: number;
};

type GameActions = {
  start: (era?: number) => void;
  togglePause: () => void;
  nextEra: () => void;
  retryEra: () => void;
  restart: () => void;
  setBoost: (active: boolean) => void;
};

type Vec3 = [number, number, number];
type Mat4 = Float32Array;

type CameraState = {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  heading: number;
  bank: number;
  fov: number;
  speed01: number;
  previousVx: number;
  previousVz: number;
};

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void | Promise<void>;
    __timeRollTest?: {
      start: () => void;
      startEra: (index: number) => void;
      setRadiusRatio: (ratio: number) => void;
      collectItem: (id: number) => boolean;
      warpToItem: (id: number) => boolean;
      unlockBoss: () => void;
      completeEra: () => void;
      nextEra: () => void;
      retry: () => void;
      setCameraHeading: (headingRadians: number) => void;
      setCameraPose: (eye: Vec3, target: Vec3, fovDegrees?: number) => void;
      setPlayerPosition: (x: number, z: number) => void;
      getState: () => string;
    };
  }
}

const THEMES: Theme[] = [
  { id: "manufacturing", label: "제조", icon: "⚙", color: [0.98, 0.36, 0.27] },
  { id: "construction", label: "건설", icon: "▦", color: [0.98, 0.72, 0.18] },
  { id: "transport", label: "수송", icon: "➜", color: [0.19, 0.65, 0.91] },
  { id: "communication", label: "통신", icon: "⌁", color: [0.46, 0.34, 0.82] },
  { id: "life", label: "생명", icon: "✿", color: [0.20, 0.72, 0.45] },
];

const THEME_BY_ID = Object.fromEntries(THEMES.map((theme) => [theme.id, theme])) as Record<
  ThemeId,
  Theme
>;

const SKIN_BY_THEME: Record<ThemeId, number> = {
  manufacturing: 1,
  construction: 14,
  transport: 16,
  communication: 18,
  life: 21,
};

const ERA_GROUND_SKINS = [24, 13, 15, 5, 23] as const;

const MATERIAL_ATLAS_TILE_COUNT = 25;
const OBJECT_GEOMETRY_FAMILY_COUNT = 5;
const OBJECT_ATLAS_PRIMARY_TILE_COUNT = 50;
const OBJECT_ATLAS_ENVIRONMENT_TILE_COUNT = 50;
const OBJECT_VARIANTS_PER_THEME = 20;
const FACADE_ATLAS_TILE_COUNT = 25;
const THEME_INDEX: Record<ThemeId, number> = {
  manufacturing: 0,
  construction: 1,
  transport: 2,
  communication: 3,
  life: 4,
};

const ERAS: Era[] = [
  {
    name: "손으로 만드는 마을",
    shortName: "손도구",
    year: "아주 오래전",
    focus: "manufacturing",
    mission: "작은 도구를 모아 시간 구슬을 키워요",
    baseRadius: 0.82,
    arenaUnits: 22,
    seconds: 75,
    goal: 8,
    ground: [0.78, 0.87, 0.70],
    sky: [0.68, 0.88, 0.98],
  },
  {
    name: "기계가 움직이는 도시",
    shortName: "건설도시",
    year: "산업의 시대",
    focus: "construction",
    mission: "벽돌과 건설 도구로 도시를 세워요",
    baseRadius: 1.48,
    arenaUnits: 23,
    seconds: 80,
    goal: 9,
    ground: [0.86, 0.83, 0.66],
    sky: [0.72, 0.88, 0.97],
  },
  {
    name: "길과 바다가 이어진 세상",
    shortName: "수송시대",
    year: "이동의 시대",
    focus: "transport",
    mission: "탈것과 운송 도구를 모아 더 멀리 가요",
    baseRadius: 2.72,
    arenaUnits: 24,
    seconds: 85,
    goal: 10,
    ground: [0.67, 0.82, 0.79],
    sky: [0.64, 0.84, 0.96],
  },
  {
    name: "정보가 날아다니는 지구",
    shortName: "정보지구",
    year: "연결의 시대",
    focus: "communication",
    mission: "통신 기기를 모아 지구 곳곳을 연결해요",
    baseRadius: 4.95,
    arenaUnits: 25,
    seconds: 90,
    goal: 11,
    ground: [0.69, 0.72, 0.87],
    sky: [0.59, 0.78, 0.95],
  },
  {
    name: "생명과 기술이 함께 사는 미래",
    shortName: "공존미래",
    year: "우리의 미래",
    focus: "life",
    mission: "생명 기술을 모아 거대한 미래 생태돔을 완성해요",
    baseRadius: 8.9,
    arenaUnits: 26,
    seconds: 100,
    goal: 12,
    ground: [0.56, 0.80, 0.68],
    sky: [0.51, 0.80, 0.91],
  },
];

const ITEM_NAMES: Record<ThemeId, string[][]> = {
  manufacturing: [
    ["나무 숟가락", "돌망치", "실패", "도르래", "토기", "손베틀"],
    ["톱니바퀴", "렌치", "재봉틀", "작업대", "금속 주형", "작은 모터"],
    ["조립 로봇", "공구 상자", "컨베이어", "정밀 부품", "3D 프린터", "용접 장치"],
    ["반도체 장비", "스마트 공장", "협동 로봇", "센서 모듈", "자동 창고", "레이저 공구"],
    ["분자 조립기", "순환 공장", "우주 제작소", "나노 로봇", "재활용 타워", "태양열 공방"],
  ],
  construction: [
    ["흙벽돌", "나무 기둥", "밧줄", "돌계단", "기와", "작은 사다리"],
    ["벽돌 더미", "철근", "안전모", "도면", "기중기 갈고리", "시멘트 통"],
    ["도로 표지", "교량 조각", "굴착기", "아파트 모형", "터널 장비", "항만 크레인"],
    ["초고층 기둥", "스마트 창문", "도시 모듈", "지진 센서", "태양광 지붕", "공중 보행로"],
    ["달기지 벽", "해상 도시", "공중 정원", "자율 건설기", "기후 돔", "우주 엘리베이터"],
  ],
  transport: [
    ["바퀴", "썰매", "나무 수레", "작은 배", "말안장", "노"],
    ["증기 바퀴", "자전거", "기차 모형", "수레", "화물 상자", "돛단배"],
    ["자동차", "버스", "비행기 날개", "컨테이너", "지하철", "화물선"],
    ["전기차", "고속열차", "드론", "공유 자전거", "자율 셔틀", "스마트 항구"],
    ["수소 비행선", "진공 열차", "달 탐사차", "태양광 배", "우주 화물선", "도시 비행체"],
  ],
  communication: [
    ["북", "봉화 바구니", "점토 편지", "깃발", "종", "전령 가방"],
    ["편지함", "전신기", "신문", "전화기", "라디오", "우표 상자"],
    ["텔레비전", "컴퓨터", "카메라", "휴대전화", "안테나", "위성 접시"],
    ["스마트폰", "통신 위성", "데이터 서버", "광케이블", "번역 이어폰", "화상 회의실"],
    ["양자 통신기", "홀로그램", "심우주 안테나", "행성 중계소", "빛 우편함", "생각 번역기"],
  ],
  life: [
    ["씨앗 주머니", "약초", "물동이", "벌통", "묘목", "곡식 바구니"],
    ["현미경", "온실 화분", "백신 상자", "양수 펌프", "농기구", "식물 표본"],
    ["구급차 모형", "연구 배양기", "도시 텃밭", "정수 장치", "생태 통로", "의료 상자"],
    ["스마트 농장", "생체 센서", "해양 연구소", "재생 의학기", "수직 숲", "돌봄 로봇"],
    ["산호 정원", "씨앗 도서관", "인공 장기실", "숲 복원기", "생태 우주선", "미래 생태돔"],
  ],
};

const SAVE_KEY = "time-roll-workshop-v1";
const EMPTY_TOTALS: Record<ThemeId, number> = {
  manufacturing: 0,
  construction: 0,
  transport: 0,
  communication: 0,
  life: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixColor(a: Vec3, b: Vec3, t: number): Vec3 {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function vecNormalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function vecCross([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function vecDot([ax, ay, az]: Vec3, [bx, by, bz]: Vec3) {
  return ax * bx + ay * by + az * bz;
}

function createCameraState(state: GameState): CameraState {
  const era = ERAS[state.era];
  const base = era.baseRadius;
  const radius = Math.max(state.radius, startingRadius(base));
  const frameRadius = mix(base, radius, 0.55);
  return {
    eye: [state.x, frameRadius * 5.15, state.z + frameRadius * 8.7],
    target: [state.x, radius * 0.92, state.z - frameRadius * 4.15],
    up: [0, 1, 0],
    heading: 0,
    bank: 0,
    fov: Math.PI / 3.45,
    speed01: 0,
    previousVx: 0,
    previousVz: 0,
  };
}

function resetCamera(camera: CameraState, state: GameState) {
  const fresh = createCameraState(state);
  camera.eye = fresh.eye;
  camera.target = fresh.target;
  camera.up = fresh.up;
  camera.heading = fresh.heading;
  camera.bank = fresh.bank;
  camera.fov = fresh.fov;
  camera.speed01 = fresh.speed01;
  camera.previousVx = fresh.previousVx;
  camera.previousVz = fresh.previousVz;
}

function updateCamera(camera: CameraState, state: GameState, dt: number) {
  const base = ERAS[state.era].baseRadius;
  const radius = Math.max(state.radius, startingRadius(base));
  const growth = clamp(getGrowthRatio(radius, base), 0.18, 1.4);
  const frameRadius = mix(base, radius, 0.5);
  const speed = Math.hypot(state.vx, state.vz);
  const speed01 = clamp(speed / (base * mix(2.8, 7.2, growth)), 0, 1);
  const desiredHeading = state.reducedMotion
    ? 0
    : speed > base * 0.035
      ? Math.atan2(state.vx, -state.vz)
      : camera.heading;
  const headingDelta = wrapAngle(desiredHeading - camera.heading);
  const headingResponse = state.reducedMotion
    ? 1
    : 1 - Math.pow(0.12, dt);
  camera.heading = wrapAngle(camera.heading + headingDelta * headingResponse);

  const turnImpulse =
    (state.vx * camera.previousVz - state.vz * camera.previousVx) /
    Math.max(base * base * 42, 0.01);
  const desiredBank = state.reducedMotion
    ? 0
    : clamp(turnImpulse * 2.1 + headingDelta * 0.58, -1, 1) * 0.105;
  const bankResponse =
    Math.abs(desiredBank) > Math.abs(camera.bank)
      ? 1 - Math.pow(0.002, dt)
      : 1 - Math.pow(0.006, dt);
  camera.bank = mix(camera.bank, desiredBank, bankResponse);
  camera.previousVx = state.vx;
  camera.previousVz = state.vz;
  camera.speed01 = mix(camera.speed01, speed01, 1 - Math.pow(0.018, dt));
  const framingSpeed01 = state.reducedMotion ? 0 : camera.speed01;

  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);
  const portrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.12;
  let distance = frameRadius * mix(7.1, 9.2, framingSpeed01);
  let height = frameRadius * mix(4.7, 4.25, framingSpeed01);
  let lookAhead = frameRadius * mix(3.8, 6.7, framingSpeed01);
  if (portrait) {
    distance *= 1.12;
    height *= 1.22;
    lookAhead *= 0.94;
  }
  const kick = state.reducedMotion ? 0 : state.cameraKick;
  distance += frameRadius * kick * 0.82;
  height += frameRadius * kick * 0.2;

  const desiredEye: Vec3 = [
    state.x - forwardX * distance + rightX * camera.bank * frameRadius * 1.8,
    height,
    state.z - forwardZ * distance + rightZ * camera.bank * frameRadius * 1.8,
  ];
  const desiredTarget: Vec3 = [
    state.x + forwardX * lookAhead,
    radius * mix(0.82, 1.08, framingSpeed01),
    state.z + forwardZ * lookAhead,
  ];
  const eyeResponse = 1 - Math.pow(0.0008, dt);
  const targetResponse = 1 - Math.pow(0.00004, dt);
  for (let axis = 0; axis < 3; axis += 1) {
    camera.eye[axis] = mix(camera.eye[axis], desiredEye[axis], eyeResponse);
    camera.target[axis] = mix(camera.target[axis], desiredTarget[axis], targetResponse);
  }
  let slowFov = Math.PI / 3.45;
  let fastFov = Math.PI / 2.9;
  if (portrait) {
    slowFov = Math.PI / 3.7;
    fastFov = Math.PI / 3.15;
  }
  const desiredFov = state.reducedMotion ? Math.PI / 3.45 : mix(slowFov, fastFov, camera.speed01);
  camera.fov = mix(camera.fov, desiredFov, 1 - Math.pow(0.008, dt));
  camera.up = vecNormalize([
    rightX * Math.sin(camera.bank),
    Math.cos(camera.bank),
    rightZ * Math.sin(camera.bank),
  ]);
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function mat4Perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fov / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = vecNormalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = vecNormalize(vecCross(up, z));
  const y = vecCross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -vecDot(x, eye);
  out[13] = -vecDot(y, eye);
  out[14] = -vecDot(z, eye);
  out[15] = 1;
  return out;
}

function projectPoint(matrix: Mat4, point: Vec3, width: number, height: number) {
  const clipX = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12];
  const clipY = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13];
  const clipZ = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14];
  const clipW = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
  const invW = 1 / Math.max(Math.abs(clipW), 0.000001);
  return {
    x: (clipX * invW * 0.5 + 0.5) * width,
    y: (0.5 - clipY * invW * 0.5) * height,
    z: clipZ * invW,
  };
}

function playerFramingSnapshot(state: GameState, camera: CameraState, canvas: HTMLCanvasElement) {
  const width = canvas.width || canvas.clientWidth || 1;
  const height = canvas.height || canvas.clientHeight || 1;
  const forward = vecNormalize([
    camera.target[0] - camera.eye[0],
    camera.target[1] - camera.eye[1],
    camera.target[2] - camera.eye[2],
  ]);
  const right = vecNormalize(vecCross(forward, camera.up));
  const up = vecNormalize(camera.up);
  const center: Vec3 = [state.x, state.radius, state.z];
  const base = ERAS[state.era].baseRadius;
  const halo = Math.max(state.radius, base * (state.lowQuality ? 0.32 : 0.38));
  const visualRadius = Math.max(state.radius, halo * 1.08);
  const far = base * 190;
  const projection = mat4Perspective(
    camera.fov,
    width / Math.max(height, 1),
    Math.max(0.05, far / 3000),
    far,
  );
  const view = mat4LookAt(camera.eye, camera.target, camera.up);
  const viewProjection = mat4Multiply(projection, view);
  const samples = [
    center,
    [center[0] + right[0] * visualRadius, center[1] + right[1] * visualRadius, center[2] + right[2] * visualRadius] as Vec3,
    [center[0] - right[0] * visualRadius, center[1] - right[1] * visualRadius, center[2] - right[2] * visualRadius] as Vec3,
    [center[0] + up[0] * visualRadius, center[1] + up[1] * visualRadius, center[2] + up[2] * visualRadius] as Vec3,
    [center[0] - up[0] * visualRadius, center[1] - up[1] * visualRadius, center[2] - up[2] * visualRadius] as Vec3,
  ].map((point) => projectPoint(viewProjection, point, width, height));
  const centerScreen = samples[0];
  const radiusPx = Math.max(
    Math.hypot(samples[1].x - centerScreen.x, samples[1].y - centerScreen.y),
    Math.hypot(samples[2].x - centerScreen.x, samples[2].y - centerScreen.y),
    Math.hypot(samples[3].x - centerScreen.x, samples[3].y - centerScreen.y),
    Math.hypot(samples[4].x - centerScreen.x, samples[4].y - centerScreen.y),
  );
  const ballBounds = {
    left: centerScreen.x - radiusPx,
    top: centerScreen.y - radiusPx,
    right: centerScreen.x + radiusPx,
    bottom: centerScreen.y + radiusPx,
  };
  const clipDepth = Math.max(
    0,
    -ballBounds.left,
    -ballBounds.top,
    ballBounds.right - width,
    ballBounds.bottom - height,
  );
  return {
    viewport: { width, height },
    ballBounds: {
      left: Number(ballBounds.left.toFixed(1)),
      top: Number(ballBounds.top.toFixed(1)),
      right: Number(ballBounds.right.toFixed(1)),
      bottom: Number(ballBounds.bottom.toFixed(1)),
    },
    center: {
      x: Number(centerScreen.x.toFixed(1)),
      y: Number(centerScreen.y.toFixed(1)),
    },
    radiusPx: Number(radiusPx.toFixed(1)),
    clipDepth: Number(clipDepth.toFixed(1)),
    fullyInViewport: clipDepth <= 0.5,
  };
}

function mat4Translation(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function mat4Scale(x: number, y: number, z: number): Mat4 {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

function mat4RotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function mat4RotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function mat4RotationZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

type RawMesh = {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
};

type GpuMesh = {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  uv: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
};

type DrawTextureOptions = {
  skinTile?: number;
  objectTile?: number;
  facadeTile?: number;
  textureBlend?: number;
  textureScale?: number | [number, number];
};

type DrawCommand = {
  meshName: MeshName;
  color: Vec3;
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
  alpha: number;
  gloss: number;
  skinTile: number;
  objectTile: number;
  facadeTile: number;
  textureBlend: number;
  textureScale: [number, number];
  distanceSquared: number;
};

type RenderStats = {
  drawCalls: number;
  triangles: number;
  transparentCalls: number;
  culledItems: number;
  renderedItems: number;
  frameMsP95: number;
};

type ItemRenderLod = "full" | "simple";

type VisibleCollectible = {
  item: Collectible;
  lod: ItemRenderLod;
  drawShadow: boolean;
  priority: number;
  distance: number;
};

function makePlane(): RawMesh {
  return {
    positions: [
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
      0.5, -0.5, 0,
      -0.5, -0.5, 0,
      -0.5, 0.5, 0,
      0.5, 0.5, 0,
    ],
    normals: [
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    ],
    uvs: [
      0, 1, 1, 1, 1, 0, 0, 0,
      1, 1, 0, 1, 0, 0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  };
}

function makeCube(): RawMesh {
  const positions = [
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
    -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  ];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ];
  const uvs: number[] = [];
  for (let face = 0; face < 6; face += 1) {
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  }
  const indices: number[] = [];
  for (let face = 0; face < 6; face += 1) {
    const offset = face * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return { positions, normals, uvs, indices };
}

function makeSphere(rows = 9, columns = 14): RawMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const phi = v * Math.PI;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x * 0.5, y * 0.5, z * 0.5);
      normals.push(x, y, z);
      uvs.push(u, 1 - v);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, uvs, indices };
}

function makeCylinder(segments = 12, topRadius = 0.5, bottomRadius = 0.5): RawMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * bottomRadius, -0.5, z * bottomRadius, x * topRadius, 0.5, z * topRadius);
    normals.push(x, 0.18, z, x, 0.18, z);
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < segments; i += 1) {
    const offset = i * 2;
    indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, -0.5, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);
  const bottomRing = positions.length / 3;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * bottomRadius, -0.5, z * bottomRadius);
    normals.push(0, -1, 0);
    uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
  }
  const topCenter = positions.length / 3;
  positions.push(0, 0.5, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);
  const topRing = positions.length / 3;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * topRadius, 0.5, z * topRadius);
    normals.push(0, 1, 0);
    uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
  }
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(bottomCenter, bottomRing + i, bottomRing + next);
    if (topRadius > 0) {
      indices.push(topCenter, topRing + next, topRing + i);
    }
  }
  return { positions, normals, uvs, indices };
}

class WebGlToyRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private vertexShader: WebGLShader;
  private fragmentShader: WebGLShader;
  private meshes: Record<MeshName, GpuMesh>;
  private positionLocation: number;
  private normalLocation: number;
  private uvLocation: number;
  private modelLocation: WebGLUniformLocation;
  private viewProjectionLocation: WebGLUniformLocation;
  private colorLocation: WebGLUniformLocation;
  private alphaLocation: WebGLUniformLocation;
  private cameraLocation: WebGLUniformLocation;
  private fogColorLocation: WebGLUniformLocation;
  private fogNearLocation: WebGLUniformLocation;
  private fogFarLocation: WebGLUniformLocation;
  private glossLocation: WebGLUniformLocation;
  private normalScaleLocation: WebGLUniformLocation;
  private materialAtlasLocation: WebGLUniformLocation;
  private objectAtlasLocation: WebGLUniformLocation;
  private objectEnvironmentAtlasLocation: WebGLUniformLocation;
  private facadeAtlasLocation: WebGLUniformLocation;
  private atlasLoadedLocation: WebGLUniformLocation;
  private objectAtlasLoadedLocation: WebGLUniformLocation;
  private facadeAtlasLoadedLocation: WebGLUniformLocation;
  private skinTileLocation: WebGLUniformLocation;
  private objectTileLocation: WebGLUniformLocation;
  private facadeTileLocation: WebGLUniformLocation;
  private textureBlendLocation: WebGLUniformLocation;
  private textureScaleLocation: WebGLUniformLocation;
  private viewProjection: Mat4 = new Float32Array(16);
  private canvas: HTMLCanvasElement;
  private lowQuality: boolean;
  private materialAtlas: WebGLTexture;
  private objectAtlas: WebGLTexture;
  private objectEnvironmentAtlas: WebGLTexture;
  private facadeAtlas: WebGLTexture;
  private materialAtlasLoaded = false;
  private objectAtlasLoaded = false;
  private objectEnvironmentAtlasLoaded = false;
  private facadeAtlasLoaded = false;
  private transparentCommands: DrawCommand[] = [];
  private cameraEye: Vec3 = [0, 0, 0];
  private renderStats: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    transparentCalls: 0,
    culledItems: 0,
    renderedItems: 0,
    frameMsP95: 0,
  };
  private frameSamples: number[] = [];
  private previousBeginTime = 0;
  private pendingTextureImages: HTMLImageElement[] = [];
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, lowQuality = false) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: !lowQuality,
    });
    if (!gl) {
      throw new Error("이 기기에서 WebGL을 사용할 수 없습니다.");
    }
    this.canvas = canvas;
    this.lowQuality = lowQuality;
    this.gl = gl;
    const vertexShader = this.compile(
      gl.VERTEX_SHADER,
      `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        attribute vec2 aUv;
        uniform mat4 uModel;
        uniform mat4 uViewProjection;
        uniform vec3 uNormalScale;
        varying vec3 vNormal;
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vec4 world = uModel * vec4(aPosition, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(uModel) * (aNormal * uNormalScale));
          vUv = aUv;
          gl_Position = uViewProjection * world;
        }
      `,
    );
    const fragmentShader = this.compile(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        varying vec3 vNormal;
        varying vec3 vWorld;
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform vec3 uCamera;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform float uGloss;
        uniform sampler2D uMaterialAtlas;
        uniform sampler2D uObjectAtlas;
        uniform sampler2D uObjectEnvironmentAtlas;
        uniform sampler2D uFacadeAtlas;
        uniform bool uAtlasLoaded;
        uniform bool uObjectAtlasLoaded;
        uniform bool uFacadeAtlasLoaded;
        uniform float uSkinTile;
        uniform float uObjectTile;
        uniform float uFacadeTile;
        uniform float uTextureBlend;
        uniform vec2 uTextureScale;

        vec3 atlasColor() {
          float tile = clamp(floor(uSkinTile + 0.5), 0.0, 24.0);
          float column = mod(tile, 5.0);
          float row = floor(tile / 5.0);
          vec2 safeUv = mix(vec2(0.015), vec2(0.985), fract(vUv * max(uTextureScale, vec2(0.0001))));
          vec2 atlasUv = (vec2(column, row) + safeUv) / 5.0;
          return texture2D(uMaterialAtlas, atlasUv).rgb;
        }

        vec4 chromaKey(vec4 sampled) {
          float magentaDistance = distance(sampled.rgb, vec3(1.0, 0.0, 1.0));
          bool isMagentaKey =
            magentaDistance < 0.38 ||
            (
              sampled.r > 0.54 &&
              sampled.b > 0.45 &&
              sampled.g < 0.30 &&
              sampled.r + sampled.b > 1.08 &&
              abs(sampled.r - sampled.b) < 0.34
            );
          if (isMagentaKey) discard;
          return sampled;
        }

        vec4 objectAtlasColor() {
          float tile = clamp(floor(uObjectTile + 0.5), 0.0, 99.0);
          float theme = floor(tile / 20.0);
          float kind = mod(tile, 20.0);
          vec2 safeUv = mix(vec2(0.026), vec2(0.974), vUv);
          if (kind < 10.0) {
            vec2 atlasUv = (vec2(kind, theme) + safeUv) / vec2(10.0, 5.0);
            return chromaKey(texture2D(uObjectAtlas, atlasUv));
          }
          vec2 atlasUv = (vec2(kind - 10.0, theme) + safeUv) / vec2(10.0, 5.0);
          return chromaKey(texture2D(uObjectEnvironmentAtlas, atlasUv));
        }

        vec4 facadeAtlasColor() {
          float tile = clamp(floor(uFacadeTile + 0.5), 0.0, 24.0);
          float column = mod(tile, 5.0);
          float row = floor(tile / 5.0);
          vec2 safeUv = mix(vec2(0.026), vec2(0.974), vUv);
          vec2 atlasUv = (vec2(column, row) + safeUv) / 5.0;
          return chromaKey(texture2D(uFacadeAtlas, atlasUv));
        }

        void main() {
          vec4 decalSample = vec4(0.0);
          float decalMix = 0.0;
          if (uFacadeAtlasLoaded && uFacadeTile >= 0.0) {
            decalSample = facadeAtlasColor();
            decalMix = decalSample.a;
          }
          if (uObjectAtlasLoaded && uObjectTile >= 0.0) {
            decalSample = objectAtlasColor();
            decalMix = max(decalMix, decalSample.a);
          }
          vec3 normal = normalize(vNormal);
          vec3 lightDirection = normalize(vec3(-0.48, 0.88, 0.34));
          vec3 viewDirection = normalize(uCamera - vWorld);
          vec3 halfDirection = normalize(lightDirection + viewDirection);
          float diffuse = max(dot(normal, lightDirection), 0.0);
          float skyFill = normal.y * 0.5 + 0.5;
          float backFill = max(dot(normal, normalize(vec3(0.32, 0.55, -0.72))), 0.0);
          float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.2);
          float specular = pow(max(dot(normal, halfDirection), 0.0), mix(10.0, 42.0, uGloss));
          vec3 baseColor = uColor;
          if (uAtlasLoaded && uSkinTile >= 0.0 && uTextureBlend > 0.0) {
            vec3 sampledMaterial = atlasColor();
            vec3 tintedMaterial = mix(sampledMaterial, sampledMaterial * uColor * 1.12, 0.24);
            baseColor = mix(baseColor, tintedMaterial, clamp(uTextureBlend, 0.0, 1.0));
          }
          if (decalMix > 0.0) {
            vec3 inkSafeDecal = mix(decalSample.rgb, decalSample.rgb * uColor * 1.08, 0.08);
            baseColor = mix(baseColor, inkSafeDecal, clamp(decalMix, 0.0, 1.0));
          }
          float wrappedLight = clamp((dot(normal, lightDirection) + 0.22) / 1.22, 0.0, 1.0);
          float toonRamp =
            wrappedLight < 0.36 ? 0.28 :
            wrappedLight < 0.72 ? 0.62 :
            1.0;
          float shapedKey = mix(smoothstep(0.08, 0.94, wrappedLight), toonRamp, 0.42);
          float contactTone = mix(0.78, 1.0, smoothstep(-0.32, 0.62, normal.y));
          float groundBounce = max(-normal.y, 0.0) * 0.075;
          float rimBand = smoothstep(0.42, 0.92, rim);
          vec2 detailUv = fract(vUv * max(uTextureScale, vec2(1.0)));
          float microGroove = (smoothstep(0.0, 0.055, detailUv.x) * smoothstep(1.0, 0.945, detailUv.x)) *
            (smoothstep(0.0, 0.055, detailUv.y) * smoothstep(1.0, 0.945, detailUv.y));
          float toyCrease = mix(0.92, 1.04, microGroove);
          float roughSpec = mix(0.52, 1.06, clamp(uGloss, 0.0, 1.0)) * mix(0.9, 0.68, decalMix);
          vec3 color =
            baseColor * contactTone * toyCrease * (0.17 + shapedKey * 0.63 + skyFill * 0.09 + backFill * 0.045 + groundBounce) +
            vec3(1.0, 0.88, 0.66) * diffuse * 0.075 +
            vec3(specular * uGloss * roughSpec * 0.54) +
            mix(baseColor, vec3(1.0, 0.9, 0.64), 0.68) * rimBand * (0.24 + uGloss * 0.2);
          float distanceToCamera = length(uCamera - vWorld);
          float fog = smoothstep(uFogNear, uFogFar, distanceToCamera);
          color = mix(color, uFogColor, fog * (0.5 + smoothstep(0.35, 1.0, fog) * 0.16));
          color = pow(max(color, vec3(0.0)), vec3(0.92));
          gl_FragColor = vec4(color, uAlpha);
        }
      `,
    );
    const program = gl.createProgram();
    if (!program) throw new Error("WebGL 프로그램을 만들지 못했습니다.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "WebGL 링크 오류");
    }
    this.vertexShader = vertexShader;
    this.fragmentShader = fragmentShader;
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, "aPosition");
    this.normalLocation = gl.getAttribLocation(program, "aNormal");
    this.uvLocation = gl.getAttribLocation(program, "aUv");
    this.modelLocation = this.uniform("uModel");
    this.viewProjectionLocation = this.uniform("uViewProjection");
    this.colorLocation = this.uniform("uColor");
    this.alphaLocation = this.uniform("uAlpha");
    this.cameraLocation = this.uniform("uCamera");
    this.fogColorLocation = this.uniform("uFogColor");
    this.fogNearLocation = this.uniform("uFogNear");
    this.fogFarLocation = this.uniform("uFogFar");
    this.glossLocation = this.uniform("uGloss");
    this.normalScaleLocation = this.uniform("uNormalScale");
    this.materialAtlasLocation = this.uniform("uMaterialAtlas");
    this.objectAtlasLocation = this.uniform("uObjectAtlas");
    this.objectEnvironmentAtlasLocation = this.uniform("uObjectEnvironmentAtlas");
    this.facadeAtlasLocation = this.uniform("uFacadeAtlas");
    this.atlasLoadedLocation = this.uniform("uAtlasLoaded");
    this.objectAtlasLoadedLocation = this.uniform("uObjectAtlasLoaded");
    this.facadeAtlasLoadedLocation = this.uniform("uFacadeAtlasLoaded");
    this.skinTileLocation = this.uniform("uSkinTile");
    this.objectTileLocation = this.uniform("uObjectTile");
    this.facadeTileLocation = this.uniform("uFacadeTile");
    this.textureBlendLocation = this.uniform("uTextureBlend");
    this.textureScaleLocation = this.uniform("uTextureScale");
    this.materialAtlas = this.createMaterialAtlasTexture();
    this.objectAtlas = this.createObjectAtlasTexture();
    this.objectEnvironmentAtlas = this.createObjectEnvironmentAtlasTexture();
    this.facadeAtlas = this.createFacadeAtlasTexture();
    this.meshes = {
      cube: this.upload(makeCube()),
      sphere: this.upload(lowQuality ? makeSphere(9, 14) : makeSphere(14, 22)),
      cylinder: this.upload(lowQuality ? makeCylinder(12) : makeCylinder(18)),
      cone: this.upload(lowQuality ? makeCylinder(12, 0, 0.55) : makeCylinder(18, 0, 0.55)),
      plane: this.upload(makePlane()),
      roundedBox: this.upload(makeRoundedBox({ segments: lowQuality ? 2 : 4 })),
      capsule: this.upload(makeCapsule({ segments: lowQuality ? 10 : 16, rings: lowQuality ? 3 : 5 })),
      torus: this.upload(makeTorus({ segments: lowQuality ? 12 : 20, rings: lowQuality ? 4 : 8 })),
      dish: this.upload(makeDish({ segments: lowQuality ? 12 : 20, rings: lowQuality ? 3 : 5 })),
      truss: this.upload(makeTruss({ segments: lowQuality ? 3 : 5 })),
      wheel: this.upload(makeWheel({ segments: lowQuality ? 10 : 18, rings: lowQuality ? 4 : 6 })),
      kenneyCog: this.upload(KENNEY_FACTORY_MESHES.kenneyFactoryCogA),
      kenneyConveyor: this.upload(KENNEY_FACTORY_MESHES.kenneyFactoryConveyorLong),
      kenneyScanner: this.upload(KENNEY_FACTORY_MESHES.kenneyFactoryScannerHigh),
      kenneyScreen: this.upload(KENNEY_FACTORY_MESHES.kenneyFactoryScreenWide),
      kenneyCarWheel: this.upload(KENNEY_FACTORY_MESHES.kenneyCarWheelDefault),
      kenneyCarCone: this.upload(KENNEY_FACTORY_MESHES.kenneyCarCone),
      kenneyTreeOak: this.upload(KENNEY_FACTORY_MESHES.kenneyNatureTreeOak),
      kenneyMushroomRed: this.upload(KENNEY_FACTORY_MESHES.kenneyNatureMushroomRed),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compile(type: number, source: string) {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("WebGL 셰이더를 만들지 못했습니다.");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) || "WebGL 셰이더 오류");
    }
    return shader;
  }

  private uniform(name: string) {
    const location = this.gl.getUniformLocation(this.program, name);
    if (!location) throw new Error(`${name} 위치를 찾지 못했습니다.`);
    return location;
  }

  private createMaterialAtlasTexture() {
    return this.createTexture("/textures/time-roll-material-atlas-5x5.png", () => {
      this.materialAtlasLoaded = true;
    }, false);
  }

  private createObjectAtlasTexture() {
    return this.createTexture("/textures/time-roll-object-atlas-10x5.png", () => {
      this.objectAtlasLoaded = true;
    }, true);
  }

  private createObjectEnvironmentAtlasTexture() {
    return this.createTexture("/textures/time-roll-object-atlas-environment-10x5.png", () => {
      this.objectEnvironmentAtlasLoaded = true;
    }, true);
  }

  private createFacadeAtlasTexture() {
    return this.createTexture("/textures/time-roll-facade-atlas-5x5.png", () => {
      this.facadeAtlasLoaded = true;
    }, true);
  }

  private createTexture(src: string, onLoad: () => void, nearest: boolean) {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("WebGL 텍스처를 만들지 못했습니다.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const image = new Image();
    this.pendingTextureImages.push(image);
    image.onload = () => {
      if (this.disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      onLoad();
    };
    image.src = src;
    return texture;
  }

  private upload(raw: RawMesh): GpuMesh {
    const vertexCount = raw.positions.length / 3;
    if (
      raw.positions.length !== raw.normals.length ||
      vertexCount !== raw.uvs.length / 2 ||
      raw.positions.length % 3 !== 0 ||
      raw.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)
    ) {
      throw new Error("3D 물체 데이터가 올바르지 않습니다.");
    }
    const gl = this.gl;
    const position = gl.createBuffer();
    const normal = gl.createBuffer();
    const uv = gl.createBuffer();
    const index = gl.createBuffer();
    if (!position || !normal || !uv || !index) throw new Error("WebGL 버퍼를 만들지 못했습니다.");
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.positions), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.normals), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.uvs), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(raw.indices), gl.STATIC_DRAW);
    return { position, normal, uv, index, count: raw.indices.length };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const image of this.pendingTextureImages) {
      image.onload = null;
      image.onerror = null;
    }
    this.pendingTextureImages.length = 0;
    this.transparentCommands.length = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    for (const mesh of Object.values(this.meshes)) {
      gl.deleteBuffer(mesh.position);
      gl.deleteBuffer(mesh.normal);
      gl.deleteBuffer(mesh.uv);
      gl.deleteBuffer(mesh.index);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(this.materialAtlas);
    gl.deleteTexture(this.objectAtlas);
    gl.deleteTexture(this.objectEnvironmentAtlas);
    gl.deleteTexture(this.facadeAtlas);
    gl.useProgram(null);
    gl.detachShader(this.program, this.vertexShader);
    gl.detachShader(this.program, this.fragmentShader);
    gl.deleteShader(this.vertexShader);
    gl.deleteShader(this.fragmentShader);
    gl.deleteProgram(this.program);
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, this.lowQuality ? 1.15 : 1.6);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  begin(sky: Vec3, camera: CameraState, far: number, fogNear: number, fogFar: number) {
    this.resize();
    const gl = this.gl;
    const now = performance.now();
    if (this.previousBeginTime > 0) {
      this.frameSamples.push(now - this.previousBeginTime);
      if (this.frameSamples.length > 90) this.frameSamples.shift();
    }
    this.previousBeginTime = now;
    this.renderStats = {
      drawCalls: 0,
      triangles: 0,
      transparentCalls: 0,
      culledItems: 0,
      renderedItems: 0,
      frameMsP95: this.sampleP95(),
    };
    this.transparentCommands.length = 0;
    this.cameraEye = [camera.eye[0], camera.eye[1], camera.eye[2]];
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const projection = mat4Perspective(
      camera.fov,
      this.canvas.width / Math.max(this.canvas.height, 1),
      Math.max(0.05, far / 3000),
      far,
    );
    const view = mat4LookAt(camera.eye, camera.target, camera.up);
    this.viewProjection = mat4Multiply(projection, view);
    gl.uniformMatrix4fv(this.viewProjectionLocation, false, this.viewProjection);
    gl.uniform3fv(this.cameraLocation, camera.eye);
    gl.uniform3fv(this.fogColorLocation, sky);
    gl.uniform1f(this.fogNearLocation, fogNear);
    gl.uniform1f(this.fogFarLocation, fogFar);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.materialAtlas);
    gl.uniform1i(this.materialAtlasLocation, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.objectAtlas);
    gl.uniform1i(this.objectAtlasLocation, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.objectEnvironmentAtlas);
    gl.uniform1i(this.objectEnvironmentAtlasLocation, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.facadeAtlas);
    gl.uniform1i(this.facadeAtlasLocation, 3);
    gl.uniform1i(this.atlasLoadedLocation, this.materialAtlasLoaded ? 1 : 0);
    gl.uniform1i(
      this.objectAtlasLoadedLocation,
      this.objectAtlasLoaded && this.objectEnvironmentAtlasLoaded ? 1 : 0,
    );
    gl.uniform1i(this.facadeAtlasLoadedLocation, this.facadeAtlasLoaded ? 1 : 0);
  }

  draw(
    meshName: MeshName,
    color: Vec3,
    position: Vec3,
    scale: Vec3,
    rotation: Vec3 = [0, 0, 0],
    alpha = 1,
    gloss = 0.22,
    texture: number | DrawTextureOptions = -1,
    textureBlend = 1,
    textureScale: number | [number, number] = 1,
  ) {
    const resolvedAlpha = this.lowQuality && alpha >= 0.82 ? 1 : alpha;
    const textureOptions =
      typeof texture === "number"
        ? { skinTile: texture, textureBlend, textureScale }
        : texture;
    const skinTile = clamp(
      Math.round(textureOptions.skinTile ?? -1),
      -1,
      MATERIAL_ATLAS_TILE_COUNT - 1,
    );
    const objectTile = clamp(
      Math.round(textureOptions.objectTile ?? -1),
      -1,
      OBJECT_ATLAS_PRIMARY_TILE_COUNT + OBJECT_ATLAS_ENVIRONMENT_TILE_COUNT - 1,
    );
    const facadeTile = clamp(
      Math.round(textureOptions.facadeTile ?? -1),
      -1,
      FACADE_ATLAS_TILE_COUNT - 1,
    );
    const scaleValue = textureOptions.textureScale ?? 1;
    const resolvedTextureScale: [number, number] =
      typeof scaleValue === "number" ? [scaleValue, scaleValue] : scaleValue;
    const command: DrawCommand = {
      meshName,
      color,
      position,
      scale,
      rotation,
      alpha: resolvedAlpha,
      gloss,
      skinTile,
      objectTile,
      facadeTile,
      textureBlend: clamp(textureOptions.textureBlend ?? (skinTile >= 0 ? 1 : 0), 0, 1),
      textureScale: [
        Math.max(resolvedTextureScale[0], 0.0001),
        Math.max(resolvedTextureScale[1], 0.0001),
      ],
      distanceSquared: 0,
    };
    if (resolvedAlpha < 0.999) {
      const dx = position[0] - this.cameraEye[0];
      const dy = position[1] - this.cameraEye[1];
      const dz = position[2] - this.cameraEye[2];
      this.transparentCommands.push({ ...command, distanceSquared: dx * dx + dy * dy + dz * dz });
      this.renderStats.transparentCalls += 1;
      return;
    }
    this.drawImmediate(command);
  }

  drawObjectDecal(tile: number, position: Vec3, size: number, yaw: number, alpha = 1) {
    if (!this.lowQuality) {
      this.draw(
        "roundedBox",
        [0.78, 0.84, 0.74],
        [
          position[0] - Math.sin(yaw) * size * 0.018,
          position[1],
          position[2] - Math.cos(yaw) * size * 0.018,
        ],
        [size * 0.98, size * 0.98, size * 0.035],
        [0, yaw, 0],
        alpha,
        0.66,
        { skinTile: 24, textureBlend: 0.38, textureScale: 1.4 },
      );
      this.draw(
        "roundedBox",
        [0.98, 0.82, 0.34],
        [
          position[0] - Math.sin(yaw) * size * 0.006,
          position[1],
          position[2] - Math.cos(yaw) * size * 0.006,
        ],
        [size * 0.92, size * 0.92, size * 0.026],
        [0, yaw, 0],
        alpha,
        0.72,
        { skinTile: 3, textureBlend: 0.58, textureScale: 1.2 },
      );
    }
    this.draw(
      "plane",
      [1, 1, 1],
      position,
      [size * 0.9, size * 0.9, size],
      [0, yaw, 0],
      alpha,
      1,
      { objectTile: tile, textureBlend: 0 },
    );
  }

  drawFacadeDecal(
    tile: number,
    position: Vec3,
    width: number,
    height: number,
    yaw: number,
    alpha = 1,
  ) {
    if (!this.lowQuality) {
      this.draw(
        "roundedBox",
        [0.72, 0.8, 0.72],
        [
          position[0] - Math.sin(yaw) * width * 0.012,
          position[1],
          position[2] - Math.cos(yaw) * width * 0.012,
        ],
        [width * 1.0, height * 1.0, Math.max(width, height) * 0.03],
        [0, yaw, 0],
        alpha,
        0.58,
        { skinTile: 24, textureBlend: 0.34, textureScale: [1.2, 1.6] },
      );
    }
    this.draw(
      "plane",
      [1, 1, 1],
      position,
      [width * 0.92, height * 0.92, 1],
      [0, yaw, 0],
      alpha,
      1,
      { facadeTile: tile, textureBlend: 0 },
    );
  }

  flushTransparent() {
    if (this.transparentCommands.length === 0) return;
    const gl = this.gl;
    this.transparentCommands.sort((a, b) => b.distanceSquared - a.distanceSquared);
    gl.depthMask(false);
    for (const command of this.transparentCommands) this.drawImmediate(command);
    gl.depthMask(true);
    this.transparentCommands.length = 0;
  }

  recordRenderedItem() {
    this.renderStats.renderedItems += 1;
  }

  recordCulledItem(count = 1) {
    this.renderStats.culledItems += count;
  }

  getRenderStats(): RenderStats {
    return { ...this.renderStats };
  }

  private sampleP95() {
    if (this.frameSamples.length === 0) return 0;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  private drawImmediate(command: DrawCommand) {
    const gl = this.gl;
    const mesh = this.meshes[command.meshName];
    this.renderStats.drawCalls += 1;
    this.renderStats.triangles += mesh.count / 3;
    const { position, rotation, scale } = command;
    let model = mat4Translation(position[0], position[1], position[2]);
    model = mat4Multiply(model, mat4RotationY(rotation[1]));
    model = mat4Multiply(model, mat4RotationX(rotation[0]));
    model = mat4Multiply(model, mat4RotationZ(rotation[2]));
    model = mat4Multiply(model, mat4Scale(scale[0], scale[1], scale[2]));
    gl.uniformMatrix4fv(this.modelLocation, false, model);
    gl.uniform3fv(this.colorLocation, command.color);
    gl.uniform1f(this.alphaLocation, command.alpha);
    gl.uniform1f(this.glossLocation, command.gloss);
    gl.uniform1f(this.skinTileLocation, command.skinTile);
    gl.uniform1f(this.objectTileLocation, command.objectTile);
    gl.uniform1f(this.facadeTileLocation, command.facadeTile);
    gl.uniform1f(this.textureBlendLocation, command.textureBlend);
    gl.uniform2fv(this.textureScaleLocation, command.textureScale);
    gl.uniform3fv(this.normalScaleLocation, [
      1 / Math.max(scale[0] * scale[0], 0.000001),
      1 / Math.max(scale[1] * scale[1], 0.000001),
      1 / Math.max(scale[2] * scale[2], 0.000001),
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
    gl.enableVertexAttribArray(this.normalLocation);
    gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
    gl.enableVertexAttribArray(this.uvLocation);
    gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}

function shapeForTheme(theme: ThemeId): MeshName {
  if (theme === "manufacturing") return "capsule";
  if (theme === "construction") return "roundedBox";
  if (theme === "transport") return "wheel";
  if (theme === "communication") return "dish";
  return "sphere";
}

function pathBaseSkin(eraIndex: number, groundSkin: number) {
  if (eraIndex === 0) return 8;
  if (eraIndex === 4) return 7;
  return groundSkin;
}

function pathSegmentSkin(index: number, eraIndex: number, focusTheme: ThemeId, groundSkin: number) {
  const segmentPhase = index % 4;
  if (segmentPhase === 1) return SKIN_BY_THEME[focusTheme];
  if (segmentPhase === 3) {
    return eraIndex === 0 ? 11 : groundSkin;
  }
  return pathBaseSkin(eraIndex, groundSkin);
}

function pathSegmentMix(index: number, focusColor: [number, number, number], groundEdge: [number, number, number]) {
  const colorPhase = index % 3;
  if (colorPhase === 0) return { color: focusColor, amount: 0.16 };
  if (colorPhase === 1) return { color: [1, 0.94, 0.7] as [number, number, number], amount: 0.1 };
  return { color: groundEdge, amount: 0.08 };
}

function clusterMeshForEra(eraIndex: number, index: number): MeshName {
  if (eraIndex === 0) return index % 2 === 0 ? "kenneyCog" : "kenneyConveyor";
  if (eraIndex === 1) return "truss";
  if (eraIndex === 2) return "kenneyCarCone";
  if (eraIndex === 3) return "dish";
  return index % 2 === 0 ? "kenneyTreeOak" : "kenneyMushroomRed";
}

function detailShapeForIndex(index: number): MeshName {
  if (index % 5 === 0) return "cone";
  if (index % 3 === 0) return "sphere";
  if (index % 2 === 0) return "cube";
  return "cylinder";
}

function simpleItemShape(imageFamily: number, theme: ThemeId, fallbackShape: MeshName): MeshName {
  if (imageFamily === 0) return "capsule";
  if (imageFamily === 1) return "roundedBox";
  if (imageFamily === 2) return "cone";
  if (imageFamily === 3) {
    return theme === "transport" ? "wheel" : "dish";
  }
  return fallbackShape;
}

function objectKindFor(theme: ThemeId, sequence: number) {
  return (sequence + THEME_INDEX[theme] * 3) % OBJECT_VARIANTS_PER_THEME;
}

function decalTileFor(theme: ThemeId, objectKind: number) {
  return THEME_INDEX[theme] * OBJECT_VARIANTS_PER_THEME + (objectKind % OBJECT_VARIANTS_PER_THEME);
}

function otherFocusTheme(theme: ThemeId): ThemeId {
  return THEMES[(THEME_INDEX[theme] + 2) % THEMES.length].id;
}

function tierRangeRadius(base: number, tierId: GrowthTierId, t: number) {
  const tier = GROWTH_TIERS.find((entry) => entry.id === tierId) ?? GROWTH_TIERS[0];
  return base * mix(tier.itemRadiusRangeRatio[0], tier.itemRadiusRangeRatio[1], clamp(t, 0, 1));
}

function tierForPath(t: number): GrowthTierId {
  if (t < 0.34) return "tiny";
  if (t < 0.55) return "small";
  if (t < 0.73) return "medium";
  if (t < 0.9) return "large";
  return "monument";
}

function updateGrowthState(state: GameState) {
  const era = ERAS[state.era];
  const tier = getGrowthTier(state.radius, era.baseRadius);
  const next = getNextTier(state.radius, era.baseRadius);
  state.growthTier = tier.id;
  state.growthRatio = getGrowthRatio(state.radius, era.baseRadius);
  state.nextUnlockRatio = next?.thresholdRatio ?? null;
  state.finalReady = state.bossReady;
}

function collectionMultiplier(item: Collectible, focus: ThemeId) {
  if (item.special) return 1.35;
  return item.theme === focus ? 1.15 : 0.9;
}

function scoreForItem(item: Collectible, state: GameState) {
  const era = ERAS[state.era];
  const sizePoints = Math.round((item.r / era.baseRadius) * 900);
  const focusBonus = item.theme === era.focus ? 120 : 45;
  const specialBonus = item.special ? 1600 : 0;
  return Math.round((sizePoints + focusBonus + specialBonus) * (1 + Math.min(state.combo, 8) * 0.12));
}

function rankFor(eraScore: number, maxCombo: number, bossCollected: boolean) {
  if (bossCollected && eraScore >= 5200 && maxCombo >= 7) return "S";
  if (bossCollected && eraScore >= 3400 && maxCombo >= 4) return "A";
  return "B";
}

function generateItems(eraIndex: number, seed: number): Collectible[] {
  const era = ERAS[eraIndex];
  const random = seededRandom(seed + eraIndex * 971);
  const base = era.baseRadius;
  const items: Collectible[] = [];
  const focusNames = ITEM_NAMES[era.focus][eraIndex];
  const trailCount = Math.max(24, era.goal * 2);

  for (let index = 0; index < trailCount; index += 1) {
    const sizeT = index / Math.max(1, trailCount - 1);
    const tier = tierForPath(sizeT);
    const kind = objectKindFor(era.focus, index);
    items.push({
      id: items.length,
      name: focusNames[index % focusNames.length],
      theme: era.focus,
      era: eraIndex,
      x: Math.sin(index * 1.22) * base * 1.25,
      z: -base * (2.8 + index * 1.38),
      r: tierRangeRadius(base, tier, (index % 5) / 4),
      yaw: random() * Math.PI * 2,
      shape: shapeForTheme(era.focus),
      objectKind: kind,
      decalTile: decalTileFor(era.focus, kind),
      collected: false,
    });
  }

  const showcaseThemes = [
    era.focus,
    "manufacturing",
    "construction",
    "transport",
    "communication",
    "life",
    era.focus,
    otherFocusTheme(era.focus),
  ] as ThemeId[];
  for (let index = 0; index < showcaseThemes.length; index += 1) {
    const theme = showcaseThemes[index];
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    const tier: GrowthTierId = lane === 0 ? "large" : lane === 1 ? "medium" : lane === 2 ? "small" : "large";
    const names = ITEM_NAMES[theme][eraIndex];
    const kind = objectKindFor(theme, index + eraIndex * 7 + 4);
    items.push({
      id: items.length,
      name: names[(index + eraIndex) % names.length],
      theme,
      era: eraIndex,
      x: side * base * mix(2.05, 3.15, lane / 3),
      z: -base * mix(2.7, 6.4, lane / 3),
      r: tierRangeRadius(base, tier, (index % 2) * 0.55 + 0.25),
      yaw: side * 0.38,
      shape: shapeForTheme(theme),
      objectKind: kind,
      decalTile: decalTileFor(theme, kind),
      collected: false,
    });
  }

  const clusterCount = 12;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const pathT = cluster / Math.max(1, clusterCount - 1);
    const centerX = Math.sin((cluster + 2) * 0.78 + eraIndex * 0.44) * base * 1.08;
    const centerZ = -base * mix(3.4, 20.6, pathT);
    for (let slot = 0; slot < 3; slot += 1) {
      const theme = slot === 0 ? era.focus : THEMES[(cluster + slot + eraIndex) % THEMES.length].id;
      const names = ITEM_NAMES[theme][eraIndex];
      const kind = objectKindFor(theme, cluster * 3 + slot + eraIndex);
      const lateral = slot === 0 ? 0 : (slot === 1 ? -1 : 1) * base * mix(2.8, 4.6, pathT);
      const tier = tierForPath(clamp(pathT + slot * 0.035, 0, 1));
      items.push({
        id: items.length,
        name: names[(cluster + slot) % names.length],
        theme,
        era: eraIndex,
        x: centerX + lateral + (random() - 0.5) * base * 0.74,
        z: centerZ + (random() - 0.5) * base * 1.72,
        r: tierRangeRadius(base, tier, random()),
        yaw: random() * Math.PI * 2,
        shape: shapeForTheme(theme),
        objectKind: kind,
        decalTile: decalTileFor(theme, kind),
        collected: false,
      });
    }
  }

  const otherThemes = THEMES.map((theme) => theme.id).filter((theme) => theme !== era.focus);
  for (let index = 0; index < 30; index += 1) {
    const theme = otherThemes[index % otherThemes.length];
    const angle = random() * Math.PI * 2;
    const distance = base * mix(4.5, era.arenaUnits * 0.9, Math.sqrt(random()));
    const names = ITEM_NAMES[theme][eraIndex];
    const kind = objectKindFor(theme, index + eraIndex * 5);
    const tier = index < 8 ? "small" : index < 18 ? "medium" : index < 26 ? "large" : "monument";
    items.push({
      id: items.length,
      name: names[Math.floor(random() * names.length)],
      theme,
      era: eraIndex,
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      r: tierRangeRadius(base, tier, random()),
      yaw: random() * Math.PI * 2,
      shape: shapeForTheme(theme),
      objectKind: kind,
      decalTile: decalTileFor(theme, kind),
      collected: false,
    });
  }

  const specialTheme = eraIndex === ERAS.length - 1 ? "life" : THEMES[(eraIndex + 1) % THEMES.length].id;
  const specialNames = [
    "거대 물레방아",
    "도시 크레인",
    "대륙 횡단 열차",
    "지구 통신 위성",
    "미래 생태돔",
  ];
  const specialKind = objectKindFor(specialTheme, 9);
  items.push({
    id: items.length,
    name: specialNames[eraIndex],
    theme: specialTheme,
    era: eraIndex,
    x: base * 0.2,
    z: -base * 20.9,
    r: base * BOSS_RADIUS_RATIO,
    yaw: 0.4,
    shape: eraIndex === ERAS.length - 1 ? "sphere" : shapeForTheme(specialTheme),
    objectKind: specialKind,
    decalTile: decalTileFor(specialTheme, specialKind),
    collected: false,
    special: true,
  });
  return items;
}

function createState(
  eraIndex = 0,
  reducedMotion = false,
  seed = 20260730,
  lowQuality = false,
): GameState {
  const era = ERAS[eraIndex];
  return {
    mode: "intro",
    era: eraIndex,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    radius: startingRadius(era.baseRadius),
    rollX: 0,
    rollZ: 0,
    timer: era.seconds,
    boost: 1,
    items: generateItems(eraIndex, seed),
    attachments: [],
    particles: [],
    themeTotals: { ...EMPTY_TOTALS },
    eraCollected: 0,
    totalCollected: 0,
    collectedLabel: "",
    message: era.mission,
    messageTime: 5,
    bumpCooldown: 0,
    shake: 0,
    cameraKick: 0,
    seed,
    reducedMotion,
    lowQuality,
    bossReady: false,
    finalReady: false,
    growthTier: getGrowthTier(startingRadius(era.baseRadius), era.baseRadius).id,
    growthRatio: getGrowthRatio(startingRadius(era.baseRadius), era.baseRadius),
    nextUnlockRatio: getNextTier(startingRadius(era.baseRadius), era.baseRadius)?.thresholdRatio ?? null,
    score: 0,
    combo: 0,
    maxCombo: 0,
    eraScore: 0,
    comboTimer: 0,
    lastCollection: "",
    blockedCollision: "",
  };
}

function formatSize(radius: number, era: number) {
  return formatPhysicalSize(radius, era).replace("약 ", "");
}

function makeHud(state: GameState, bestEra: number, bestSize: number): HudSnapshot {
  let nearest: Collectible | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const item of state.items) {
    if (item.collected) continue;
    const distance = Math.hypot(item.x - state.x, item.z - state.z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = item;
    }
  }
  updateGrowthState(state);
  const tier = getGrowthTier(state.radius, ERAS[state.era].baseRadius);
  const next = getNextTier(state.radius, ERAS[state.era].baseRadius);
  const boss = state.items.find((item) => item.special);
  const canCollect = !!nearest && canCollectByRule(state, nearest, state.bossReady);
  return {
    mode: state.mode,
    era: state.era,
    timer: state.timer,
    radius: state.radius,
    boost: state.boost,
    themeTotals: { ...state.themeTotals },
    eraCollected: state.eraCollected,
    totalCollected: state.totalCollected,
    collectedLabel: state.collectedLabel,
    message: state.messageTime > 0 ? state.message : "",
    nearbyName: nearestDistance < state.radius * 8 && nearest ? nearest.name : "",
    nearbyCanCollect: canCollect,
    bossReady: state.bossReady,
    finalReady: state.finalReady,
    growthTier: tier.id,
    growthTierLabel: tier.labelKo,
    growthRatio: state.growthRatio,
    nextUnlockRatio: next?.thresholdRatio ?? null,
    nextCollectSize: next
      ? `${Math.round(next.itemRadiusRangeRatio[0] * 100)}-${Math.round(next.itemRadiusRangeRatio[1] * 100)}%`
      : "거대 목표",
    bossName: boss?.name ?? "",
    bossCollected: !!boss?.collected,
    score: state.score,
    combo: state.combo,
    maxCombo: state.maxCombo,
    eraScore: state.eraScore,
    lastCollection: state.lastCollection,
    blockedCollision: state.blockedCollision,
    bestEra,
    bestSize,
  };
}

function rotateGroundPoint(
  originX: number,
  originZ: number,
  yaw: number,
  localX: number,
  localZ: number,
) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [originX + c * localX + s * localZ, originZ - s * localX + c * localZ] as const;
}

function drawContactShadow(
  renderer: WebGlToyRenderer,
  x: number,
  z: number,
  radius: number,
  alpha = 0.22,
  yaw = 0,
) {
  renderer.draw(
    "cylinder",
    [0.055, 0.085, 0.09],
    [x + radius * 0.08, radius * 0.01, z + radius * 0.11],
    [radius * 1.9, radius * 0.012, radius * 1.22],
    [0, yaw, 0],
    alpha,
    0.02,
  );
  renderer.draw(
    "cylinder",
    [0.035, 0.06, 0.065],
    [x + radius * 0.04, radius * 0.014, z + radius * 0.05],
    [radius * 1.18, radius * 0.012, radius * 0.78],
    [0, yaw, 0],
    alpha * 0.72,
    0.02,
  );
}

function drawToyTree(
  renderer: WebGlToyRenderer,
  x: number,
  z: number,
  scale: number,
  time: number,
  phase: number,
) {
  const sway = Math.sin(time * 0.32 + phase) * 0.025;
  drawContactShadow(renderer, x, z, scale * 0.66, 0.14, phase);
  renderer.draw(
    "cylinder",
    [0.86, 0.72, 0.48],
    [x, scale * 0.72, z],
    [scale * 0.32, scale * 1.45, scale * 0.32],
    [sway, phase, 0],
    1,
    0.16,
    { skinTile: 1, textureBlend: 0.82, textureScale: [1.4, 2.2] },
  );
  const leafA: Vec3 = [0.35, 0.82, 0.45];
  const leafB: Vec3 = [0.62, 0.91, 0.48];
  const secondaryCrown = rotateGroundPoint(
    x,
    z,
    phase,
    -scale * 0.48,
    scale * 0.05,
  );
  renderer.draw(
    "sphere",
    leafA,
    [x, scale * 1.7, z],
    [scale * 1.3, scale * 1.08, scale * 1.25],
    [0, phase, sway],
    1,
    0.24,
    { skinTile: 6, textureBlend: 0.62, textureScale: 1.2 },
  );
  renderer.draw(
    "sphere",
    leafB,
    [secondaryCrown[0], scale * 1.83, secondaryCrown[1]],
    [scale * 0.7, scale * 0.68, scale * 0.72],
    [0, phase, 0],
    1,
    0.22,
    { skinTile: 6, textureBlend: 0.52 },
  );
}

function drawPathTile(
  renderer: WebGlToyRenderer,
  x: number,
  z: number,
  width: number,
  length: number,
  yaw: number,
  skinTile: number,
  color: Vec3,
) {
  const tileLength = length * 0.88;
  const edgeColor = mixColor(color, [0.12, 0.16, 0.17], 0.24);
  const insetColor = mixColor(color, [1, 0.95, 0.64], skinTile % 2 === 0 ? 0.08 : 0.18);
  renderer.draw(
    "roundedBox",
    edgeColor,
    [x, width * 0.016, z],
    [width * 1.05, width * 0.032, tileLength * 1.04],
    [0, yaw, 0],
    1,
    0.1,
  );
  renderer.draw(
    "roundedBox",
    insetColor,
    [x, width * 0.038, z],
    [width * 0.96, width * 0.028, tileLength * 0.96],
    [0, yaw, 0],
    1,
    0.16,
    { skinTile, textureBlend: skinTile % 2 === 0 ? 0.7 : 0.84, textureScale: [1.2 + (skinTile % 3) * 0.25, Math.max(1.2, length / width)] },
  );
}

function drawCloud(
  renderer: WebGlToyRenderer,
  x: number,
  y: number,
  z: number,
  size: number,
  alpha: number,
) {
  const cloud: Vec3 = [0.98, 0.98, 0.94];
  renderer.draw("sphere", cloud, [x, y, z], [size * 2.2, size * 0.72, size], [0, 0, 0], alpha, 0.12);
  renderer.draw("sphere", cloud, [x - size * 0.9, y - size * 0.08, z], [size * 1.2, size * 0.58, size * 0.78], [0, 0, 0], alpha, 0.12);
  renderer.draw("sphere", cloud, [x + size * 0.95, y - size * 0.12, z], [size * 1.35, size * 0.62, size * 0.82], [0, 0, 0], alpha, 0.12);
}

function drawEraLandmark(
  renderer: WebGlToyRenderer,
  eraIndex: number,
  x: number,
  z: number,
  scale: number,
  yaw: number,
  time: number,
) {
  const focus = THEMES[eraIndex].color;
  const dark = mixColor(focus, [0.10, 0.16, 0.18], 0.45);
  const light = mixColor(focus, [1, 0.96, 0.78], 0.5);
  const localPoint = (localX: number, localZ: number, height: number): Vec3 => {
    const point = rotateGroundPoint(x, z, yaw, localX * scale, localZ * scale);
    return [point[0], height * scale, point[1]];
  };
  const drawFrontFacade = (
    tile: number,
    localX: number,
    localZ: number,
    height: number,
    width: number,
    facadeHeight: number,
  ) => {
    renderer.drawFacadeDecal(
      tile,
      localPoint(localX, localZ, height),
      width * scale,
      facadeHeight * scale,
      yaw,
    );
  };
  drawContactShadow(renderer, x, z, scale * 1.05, 0.18, yaw);
  renderer.draw(
    "roundedBox",
    mixColor(dark, [0.05, 0.08, 0.09], 0.22),
    [x, scale * 0.09, z],
    [scale * 2.45, scale * 0.18, scale * 2.08],
    [0, yaw, 0],
    1,
    0.26,
    { skinTile: SKIN_BY_THEME[THEMES[eraIndex].id], textureBlend: 0.56, textureScale: [1.8, 1.4] },
  );
  renderer.draw(
    "roundedBox",
    mixColor(focus, [1, 0.9, 0.52], 0.2),
    [x, scale * 0.22, z],
    [scale * 2.12, scale * 0.12, scale * 1.76],
    [0, yaw, 0],
    1,
    0.44,
    { skinTile: SKIN_BY_THEME[THEMES[eraIndex].id], textureBlend: 0.62, textureScale: [1.7, 1.2] },
  );
  for (const localX of [-0.86, 0.86]) {
    for (const localZ of [-0.66, 0.66]) {
      const support = localPoint(localX, localZ, 0.58);
      renderer.draw(
        "capsule",
        mixColor(dark, focus, 0.18),
        support,
        [scale * 0.12, scale * 0.72, scale * 0.12],
        [0, yaw, 0],
        1,
        0.48,
        { skinTile: SKIN_BY_THEME[THEMES[eraIndex].id], textureBlend: 0.58, textureScale: [1, 1.5] },
      );
    }
  }
  renderer.draw(
    "truss",
    mixColor(focus, [1, 0.9, 0.48], 0.18),
    [x, scale * 0.96, z],
    [scale * 1.92, scale * 0.36, scale * 0.5],
    [0, yaw, 0],
    1,
    0.52,
    { skinTile: SKIN_BY_THEME[THEMES[eraIndex].id], textureBlend: 0.5, textureScale: [2, 1] },
  );

  if (eraIndex === 0) {
    const isWorkshop = Math.sin(yaw * 3.17 + scale * 0.41) > -0.05;
    if (isWorkshop) {
      renderer.draw(
        "roundedBox",
        [0.96, 0.84, 0.64],
        [x, scale * 0.72, z],
        [scale * 1.58, scale * 1.08, scale * 1.34],
        [0, yaw, 0],
        1,
        0.16,
        { skinTile: 11, textureBlend: 0.9, textureScale: [1.5, 1.2] },
      );
      renderer.draw(
        "cone",
        [0.95, 0.63, 0.38],
        [x, scale * 1.5, z],
        [scale * 1.46, scale * 1.02, scale * 1.46],
        [0, yaw, 0],
        1,
        0.15,
        { skinTile: 10, textureBlend: 0.9, textureScale: 1.4 },
      );
      drawFrontFacade(0, 0.18, -0.653, 0.52, 0.52, 0.84);
      drawFrontFacade(1, -0.43, -0.653, 0.7, 0.42, 0.5);
      drawFrontFacade(0, -0.18, 0.653, 0.52, 0.52, 0.84);
      drawFrontFacade(1, 0.43, 0.653, 0.7, 0.42, 0.5);
      const chimney = rotateGroundPoint(x, z, yaw, scale * 0.46, scale * 0.18);
      renderer.draw("cylinder", [0.72, 0.4, 0.28], [chimney[0], scale * 1.42, chimney[1]], [scale * 0.18, scale * 0.64, scale * 0.18], [0, yaw, 0], 1, 0.18, { skinTile: 12, textureBlend: 0.9 });
      const workbench = localPoint(0.58, -0.18, 0.42);
      renderer.draw("kenneyConveyor", [0.88, 0.56, 0.28], workbench, [scale * 0.62, scale * 0.62, scale * 0.62], [0, yaw + Math.PI / 2, 0], 1, 0.5, { skinTile: 2, textureBlend: 0.54 });
    } else {
      renderer.draw("cylinder", [0.92, 0.76, 0.5], [x, scale * 0.82, z], [scale * 0.58, scale * 1.64, scale * 0.58], [0, yaw, 0], 1, 0.18, { skinTile: 9, textureBlend: 0.9, textureScale: [1, 2] });
      renderer.draw("cone", [0.94, 0.62, 0.34], [x, scale * 1.78, z], [scale * 0.72, scale * 0.72, scale * 0.72], [0, yaw, 0], 1, 0.2, { skinTile: 10, textureBlend: 0.9 });
      const wheel = rotateGroundPoint(x, z, yaw, 0, -scale * 0.64);
      renderer.draw("kenneyCog", [0.98, 0.84, 0.46], [wheel[0], scale * 1.14, wheel[1]], [scale * 1.08, scale * 1.08, scale * 1.08], [Math.PI / 2, yaw, 0], 1, 0.58, { skinTile: 1, textureBlend: 0.58, textureScale: 1.5 });
      const hub = rotateGroundPoint(x, z, yaw, 0, -scale * 0.75);
      renderer.draw("cylinder", [1, 0.9, 0.52], [hub[0], scale * 1.14, hub[1]], [scale * 0.18, scale * 0.2, scale * 0.18], [Math.PI / 2, yaw, 0], 1, 0.7, { skinTile: 3, textureBlend: 0.72 });
    }
  } else if (eraIndex === 1) {
    renderer.draw("roundedBox", dark, [x, scale * 1.02, z], [scale * 0.42, scale * 1.72, scale * 0.42], [0, yaw, 0], 1, 0.45, { skinTile: 14, textureBlend: 0.9, textureScale: [1, 2.2] });
    renderer.draw("truss", [1, 0.9, 0.46], [x, scale * 2.22, z], [scale * 2.35, scale * 0.48, scale * 0.82], [0, yaw, -0.04], 1, 0.5, { skinTile: 3, textureBlend: 0.78, textureScale: [3, 1] });
    const hook = rotateGroundPoint(x, z, yaw, scale * 0.92, 0);
    renderer.draw("capsule", light, [hook[0], scale * 1.56, hook[1]], [scale * 0.18, scale * 1.08, scale * 0.18], [0, yaw, 0], 1, 0.52, { skinTile: 3, textureBlend: 0.45 });
    renderer.draw("roundedBox", [0.92, 0.62, 0.36], [x, scale * 0.4, z], [scale * 1.78, scale * 0.58, scale * 1.32], [0, yaw, 0], 1, 0.18, { skinTile: 13, textureBlend: 0.88, textureScale: [2, 1] });
    drawFrontFacade(9, 0, -0.638, 0.34, 1.18, 0.38);
    drawFrontFacade(9, 0, 0.638, 0.34, 1.18, 0.38);
  } else if (eraIndex === 2) {
    renderer.draw("roundedBox", [0.72, 0.88, 1], [x, scale * 0.54, z], [scale * 2.45, scale * 0.92, scale * 1.16], [0, yaw, 0], 1, 0.42, { skinTile: 16, textureBlend: 0.92, textureScale: [2.4, 1] });
    renderer.draw("kenneyCarCone", [0.36, 0.78, 0.98], [x, scale * 1.0, z], [scale * 1.25, scale * 1.25, scale * 1.25], [0, yaw, 0], 1, 0.58, { skinTile: 16, textureBlend: 0.54, textureScale: [1.4, 1] });
    renderer.draw("roundedBox", [0.83, 0.98, 1], [x, scale * 1.04, z], [scale * 1.28, scale * 0.36, scale * 0.92], [0, yaw, 0], 0.96, 0.82, { skinTile: 16, textureBlend: 0.62 });
    drawFrontFacade(13, 0, -0.563, 0.48, 1.5, 0.45);
    drawFrontFacade(10, 0, -0.463, 1.02, 0.9, 0.28);
    drawFrontFacade(13, 0, 0.563, 0.48, 1.5, 0.45);
    drawFrontFacade(10, 0, 0.463, 1.02, 0.9, 0.28);
    for (const side of [-0.78, 0.78]) {
      const wheel = rotateGroundPoint(x, z, yaw, side * scale, -scale * 0.54);
      renderer.draw("kenneyCarWheel", [0.24, 0.27, 0.29], [wheel[0], scale * 0.3, wheel[1]], [scale * 0.84, scale * 0.84, scale * 0.84], [Math.PI / 2, yaw, 0], 1, 0.34, { skinTile: 17, textureBlend: 0.64 });
    }
  } else if (eraIndex === 3) {
    renderer.draw("capsule", [0.38, 0.58, 0.9], [x, scale * 1.45, z], [scale * 0.26, scale * 2.9, scale * 0.26], [0, yaw, 0], 1, 0.66, { skinTile: 18, textureBlend: 0.95, textureScale: [1, 3] });
    for (let ring = 0; ring < 3; ring += 1) {
      const pulse = (time * 0.55 + ring * 0.7) % 2.1;
      renderer.draw(
        "torus",
        focus,
        [x, scale * (2.65 + pulse * 0.1), z],
        [scale * (0.42 + pulse * 0.42), scale * 0.08, scale * (0.42 + pulse * 0.42)],
        [0, 0, 0],
        clamp(0.65 - pulse * 0.22, 0.12, 0.65),
        0.4,
      );
    }
    renderer.draw("dish", [0.74, 0.94, 1], [x, scale * 3.0, z], [scale * 1.08, scale * 1.08, scale * 1.08], [Math.PI * 0.18, yaw, 0], 1, 0.74, { skinTile: 19, textureBlend: 0.92 });
    const consoleCenter = localPoint(0, -0.44, 0.55);
    renderer.draw(
      "kenneyScreen",
      [0.3, 0.42, 0.64],
      consoleCenter,
      [scale * 1.0, scale * 1.0, scale * 1.0],
      [0, yaw, 0],
      1,
      0.7,
      { skinTile: 20, textureBlend: 0.9 },
    );
    drawFrontFacade(15, 0, -0.732, 0.55, 0.72, 0.58);
    const rearConsoleCenter = localPoint(0, 0.44, 0.55);
    renderer.draw(
      "kenneyScanner",
      [0.3, 0.42, 0.64],
      rearConsoleCenter,
      [scale * 0.88, scale * 0.88, scale * 0.88],
      [0, yaw, 0],
      1,
      0.7,
      { skinTile: 20, textureBlend: 0.9 },
    );
    drawFrontFacade(15, 0, 0.732, 0.55, 0.72, 0.58);
  } else {
    renderer.draw("capsule", [0.83, 0.72, 0.48], [x, scale * 0.82, z], [scale * 0.48, scale * 1.65, scale * 0.48], [0, yaw, 0], 1, 0.16, { skinTile: 21, textureBlend: 0.9, textureScale: [1, 2] });
    renderer.draw("kenneyTreeOak", [0.38, 0.88, 0.45], [x, scale * 0.28, z], [scale * 2.35, scale * 2.35, scale * 2.35], [0, yaw, 0], 1, 0.28, { skinTile: 21, textureBlend: 0.54, textureScale: 1.5 });
    renderer.draw("sphere", [0.56, 0.92, 0.52], [x, scale * 1.9, z], [scale * 1.55, scale * 1.3, scale * 1.55], [0, yaw, 0], 1, 0.32, { skinTile: 6, textureBlend: 0.82, textureScale: 1.4 });
    renderer.draw("sphere", [0.64, 0.96, 0.91], [x, scale * 1.7, z], [scale * 1.85, scale * 1.02, scale * 1.85], [0, yaw, 0], 0.34, 0.9, { skinTile: 22, textureBlend: 0.94, textureScale: 1.2 });
    const vestibuleCenter = localPoint(0, -0.62, 0.55);
    const mushroomCenter = localPoint(0.58, -0.82, 0.3);
    renderer.draw("kenneyMushroomRed", [0.96, 0.42, 0.34], mushroomCenter, [scale * 0.78, scale * 0.78, scale * 0.78], [0, yaw, 0], 1, 0.42, { skinTile: 21, textureBlend: 0.38 });
    renderer.draw(
      "roundedBox",
      [0.66, 0.92, 0.76],
      vestibuleCenter,
      [scale * 0.82, scale * 1.02, scale * 0.52],
      [0, yaw, 0],
      1,
      0.8,
      { skinTile: 22, textureBlend: 0.9 },
    );
    drawFrontFacade(20, 0, -0.892, 0.55, 0.72, 0.88);
    const rearVestibuleCenter = localPoint(0, 0.62, 0.55);
    renderer.draw(
      "roundedBox",
      [0.66, 0.92, 0.76],
      rearVestibuleCenter,
      [scale * 0.82, scale * 1.02, scale * 0.52],
      [0, yaw, 0],
      1,
      0.8,
      { skinTile: 22, textureBlend: 0.9 },
    );
    drawFrontFacade(20, 0, 0.892, 0.55, 0.72, 0.88);
  }
}

function drawEraDressingIsland(
  renderer: WebGlToyRenderer,
  state: GameState,
  x: number,
  z: number,
  scale: number,
  time: number,
  phase: number,
) {
  const era = ERAS[state.era];
  const focusColor = THEME_BY_ID[era.focus].color;
  renderer.draw(
    "cube",
    mixColor(era.ground, [0.12, 0.17, 0.18], 0.28),
    [x, scale * 0.045, z],
    [scale * 3.04, scale * 0.09, scale * 2.52],
    [0, phase, 0],
    1,
    0.12,
  );
  renderer.draw(
    "cube",
    mixColor(era.ground, focusColor, 0.24),
    [x, scale * 0.105, z],
    [scale * 2.82, scale * 0.05, scale * 2.3],
    [0, phase, 0],
    1,
    0.18,
  );
  renderer.draw(
    "cube",
    mixColor(focusColor, [1, 0.9, 0.52], 0.34),
    [x, scale * 0.137, z],
    [scale * 2.3, scale * 0.018, scale * 0.1],
    [0, phase, 0],
    1,
    0.42,
  );
  for (let index = 0; index < 4; index += 1) {
    const localAngle = index * 1.61;
    const propDistance = scale * mix(0.72, 1.46, index / 3);
    const propPoint = rotateGroundPoint(
      x,
      z,
      phase,
      Math.cos(localAngle) * propDistance,
      Math.sin(localAngle) * propDistance,
    );
    const propX = propPoint[0];
    const propZ = propPoint[1];
    const propYaw = phase - localAngle;
    const propScale = scale * mix(0.32, 0.52, (index % 3) / 2);
    if (state.era === 0 || state.era === 4) {
      if (index === 0) {
        drawToyTree(renderer, propX, propZ, propScale, time, phase);
      } else {
        drawContactShadow(renderer, propX, propZ, propScale * 0.7, 0.14, propYaw);
        renderer.draw(
          state.era === 0 ? "cylinder" : "sphere",
          state.era === 0
            ? [0.86, 0.6, 0.34]
            : mixColor(focusColor, [1, 0.84, 0.4], 0.18),
          [propX, propScale * 0.38, propZ],
          [propScale * 0.82, propScale * 0.74, propScale * 0.82],
          [0, propYaw, 0],
          1,
          0.34,
          {
            skinTile: state.era === 0 ? 2 : 6,
            textureBlend: 0.48,
          },
        );
      }
    } else {
      drawContactShadow(renderer, propX, propZ, propScale * 0.7, 0.14, propYaw);
      renderer.draw(
        state.era === 3 ? "cylinder" : index % 2 === 0 ? "cube" : "cone",
        mixColor(focusColor, [1, 0.88, 0.46], 0.2),
        [propX, propScale * 0.56, propZ],
        [propScale * 0.78, propScale * 1.08, propScale * 0.78],
        [0, propYaw, 0],
        1,
        0.5,
        {
          skinTile: SKIN_BY_THEME[era.focus],
          textureBlend: 0.5,
          textureScale: [1, 1.4],
        },
      );
      renderer.draw(
        "sphere",
        [1, 0.8, 0.24],
        [propX, propScale * 1.22, propZ],
        [propScale * 0.12, propScale * 0.12, propScale * 0.12],
        [0, 0, 0],
        1,
        0.9,
      );
    }
  }
}

function drawEraImageGallery(
  renderer: WebGlToyRenderer,
  state: GameState,
  camera: CameraState,
  x: number,
  z: number,
  base: number,
  yaw: number,
) {
  if (state.lowQuality) return;
  const themeIndex = THEME_INDEX[ERAS[state.era].focus];
  const themeColor = THEME_BY_ID[ERAS[state.era].focus].color;
  const objectTiles = [15, 16, 17, 18, 19, 11, 14].map(
    (kind) => themeIndex * OBJECT_VARIANTS_PER_THEME + kind,
  );
  const desktopPlacements = [
    [-2.95, 1.55, 0.5],
    [2.95, 1.58, 0.52],
  ] as const;

  desktopPlacements.forEach(([localX, localZ, sizeScale], index) => {
    const point = rotateGroundPoint(x, z, yaw, localX * base, localZ * base);
    const toCameraX = camera.eye[0] - point[0];
    const toCameraZ = camera.eye[2] - point[1];
    const cameraDistance = Math.hypot(toCameraX, toCameraZ) || 1;
    const dirX = toCameraX / cameraDistance;
    const dirZ = toCameraZ / cameraDistance;
    const displayYaw = Math.atan2(dirX, dirZ);
    const imageSize = base * 0.76 * sizeScale;
    const pedestalRadius = base * 0.28;
    const pedestalHeight = base * 0.18;
    const decalOffset = base * 0.055;
    const standColor = mixColor(themeColor, [0.6, 0.68, 0.58], 0.32);

    drawContactShadow(renderer, point[0], point[1], pedestalRadius * 1.08, 0.1, displayYaw);
    renderer.draw(
      "roundedBox",
      mixColor(standColor, [0.84, 0.9, 0.78], 0.22),
      [
        point[0] - dirX * base * 0.065,
        pedestalHeight + imageSize * 0.51,
        point[1] - dirZ * base * 0.065,
      ],
      [imageSize * 0.86, imageSize * 1.0, base * 0.18],
      [0, displayYaw, 0],
      1,
      0.82,
      {
        skinTile: SKIN_BY_THEME[ERAS[state.era].focus],
        textureBlend: 0.46,
        textureScale: 1.35,
      },
    );
    renderer.draw(
      "cylinder",
      standColor,
      [point[0], pedestalHeight * 0.5, point[1]],
      [pedestalRadius * 2, pedestalHeight, pedestalRadius * 2],
      [0, displayYaw, 0],
      1,
      0.5,
      {
        skinTile: SKIN_BY_THEME[ERAS[state.era].focus],
        textureBlend: 0.7,
      },
    );
    renderer.draw(
      "cube",
      mixColor(standColor, [1, 0.84, 0.38], 0.18),
      [
        point[0] - dirX * base * 0.035,
        pedestalHeight + imageSize * 0.27,
        point[1] - dirZ * base * 0.035,
      ],
      [base * 0.08, imageSize * 0.58, base * 0.08],
      [0, displayYaw, 0],
      1,
      0.48,
    );
    renderer.drawObjectDecal(
      objectTiles[index],
      [
        point[0] + dirX * decalOffset,
        pedestalHeight + imageSize * 0.52,
        point[1] + dirZ * decalOffset,
      ],
      imageSize,
      displayYaw,
    );
  });
}

function drawEraEnvironment(
  renderer: WebGlToyRenderer,
  state: GameState,
  camera: CameraState,
  time: number,
) {
  const era = ERAS[state.era];
  const base = era.baseRadius;
  const half = era.arenaUnits * base;
  const groundSkin = ERA_GROUND_SKINS[state.era];
  const focusColor = THEME_BY_ID[era.focus].color;
  const groundEdge = mixColor(era.ground, [0.09, 0.14, 0.15], 0.28);
  const groundCenter = mixColor(era.ground, [0.96, 0.91, 0.7], 0.06);
  const groundLight = mixColor(era.ground, [1, 0.96, 0.76], 0.13);

  renderer.draw(
    "roundedBox",
    groundEdge,
    [0, -base * 0.42, 0],
    [half * 2.34, base * 0.72, half * 2.34],
    [0, 0, 0],
    1,
    0.06,
  );
  renderer.draw(
    "roundedBox",
    groundCenter,
    [0, -base * 0.015, 0],
    [half * 2.06, base * 0.03, half * 2.06],
    [0, 0, 0],
    1,
    0.1,
  );
  const skirtBands = [
    [0, -half * 1.09, half * 2.2, half * 0.18, 0],
    [0, half * 1.09, half * 2.2, half * 0.18, 0],
    [-half * 1.09, 0, half * 0.18, half * 2.2, 0],
    [half * 1.09, 0, half * 0.18, half * 2.2, 0],
  ] as const;
  skirtBands.forEach(([bandX, bandZ, bandWidth, bandLength]) => {
    renderer.draw(
      "roundedBox",
      mixColor(groundEdge, era.sky, 0.18),
      [bandX, -base * 0.08, bandZ],
      [bandWidth, base * 0.18, bandLength],
      [0, 0, 0],
      0.72,
      0.08,
      { skinTile: groundSkin, textureBlend: 0.34, textureScale: [3.4, 1.2] },
    );
  });
  const bermCount = state.lowQuality ? 0 : 22;
  for (let index = 0; index < bermCount; index += 1) {
    const side = index % 4;
    const t = (index + 0.35) / bermCount;
    const edgeSpan = mix(-half * 0.95, half * 0.95, (t * 3.71) % 1);
    const edgeOffset = half * mix(0.92, 1.08, (index % 5) / 4);
    const x = side < 2 ? edgeSpan : (side === 2 ? -edgeOffset : edgeOffset);
    const z = side < 2 ? (side === 0 ? -edgeOffset : edgeOffset) : edgeSpan;
    const yaw = side < 2 ? 0 : Math.PI / 2;
    const bermScale = base * mix(0.45, 1.05, ((index * 7) % 11) / 10);
    renderer.draw(
      index % 3 === 0 ? "cone" : "roundedBox",
      mixColor(groundEdge, focusColor, 0.1 + (index % 4) * 0.04),
      [x, bermScale * 0.24, z],
      [bermScale * 1.8, bermScale * 0.48, bermScale * 0.78],
      [0, yaw + Math.sin(index) * 0.2, 0],
      1,
      0.14,
      { skinTile: groundSkin, textureBlend: 0.5, textureScale: [1.6, 1] },
    );
    if (!state.lowQuality && index % 4 === 0) {
      drawToyTree(renderer, x + Math.sin(index) * base * 0.42, z + Math.cos(index) * base * 0.42, bermScale * 0.42, time, yaw);
    }
  }
  const terrainZones = [
    [-half * 0.31, -half * 0.04, half * 0.46, half * 0.38, -0.12],
    [half * 0.3, -half * 0.24, half * 0.48, half * 0.42, 0.18],
    [0, -half * 0.58, half * 0.68, half * 0.3, 0],
    [-half * 0.48, -half * 0.47, half * 0.34, half * 0.24, 0.34],
    [half * 0.48, -half * 0.58, half * 0.32, half * 0.22, -0.28],
  ] as const;
  terrainZones.forEach(([zoneX, zoneZ, zoneWidth, zoneLength, zoneYaw], index) => {
    renderer.draw(
      "roundedBox",
      mixColor(groundLight, focusColor, 0.08 + index * 0.045),
      [zoneX, base * (0.009 + index * 0.002), zoneZ],
      [zoneWidth, base * 0.018, zoneLength],
      [0, zoneYaw, 0],
      1,
      0.14,
      {
        skinTile: groundSkin,
        textureBlend: 0.46,
        textureScale: [6 + index * 1.5, 5 + index],
      },
    );
  });
  if (!state.lowQuality) {
    const horizonSilhouettes = [
      [-0.82, -1.04, 1.65, 0.46, 0.2],
      [-0.38, -1.12, 1.05, 0.58, -0.14],
      [0.28, -1.08, 1.35, 0.5, 0.08],
      [0.78, -1.0, 0.98, 0.44, -0.22],
    ] as const;
    horizonSilhouettes.forEach(([xRatio, zRatio, widthRatio, heightRatio, yawOffset], index) => {
      const x = half * xRatio;
      const z = half * zRatio;
      const silhouetteColor = mixColor(mixColor(groundEdge, focusColor, 0.24), era.sky, 0.22 + index * 0.04);
      renderer.draw(
        index % 2 === 0 ? "roundedBox" : "cone",
        silhouetteColor,
        [x, base * heightRatio * 0.45, z],
        [base * widthRatio, base * heightRatio, base * 0.42],
        [0, yawOffset, 0],
        1,
        0.12,
        { skinTile: groundSkin, textureBlend: 0.42, textureScale: [2.2, 1.1] },
      );
    });
  }
  const pathColor = state.era === 3
    ? mixColor([0.22, 0.34, 0.52], [0.82, 0.94, 1], 0.2)
    : mixColor([0.98, 0.89, 0.68], era.ground, 0.24);
  const pathSkin = pathBaseSkin(state.era, groundSkin);
  const pathCount = state.lowQuality ? 3 : 9;
  for (let index = 0; index < pathCount; index += 1) {
    const z = -base * (1.55 + index * 2.16);
    const x = Math.sin(index * 0.78 + state.era * 0.44) * base * 1.08;
    const nextX = Math.sin((index + 1) * 0.78 + state.era * 0.44) * base * 1.08;
    const yaw = Math.atan2(nextX - x, -base * 2.16);
    const segmentSkin = pathSegmentSkin(index, state.era, era.focus, groundSkin);
    const segmentMix = pathSegmentMix(index, focusColor, groundEdge);
    const segmentColor = mixColor(pathColor, segmentMix.color, segmentMix.amount);
    drawPathTile(renderer, x, z, base * 1.52, base * 2.28, yaw, segmentSkin, segmentColor);
    if (!state.lowQuality && index % 3 === 1) {
      const clusterSide = index % 2 === 0 ? -1 : 1;
      const cluster = rotateGroundPoint(x, z, yaw, clusterSide * base * 1.28, base * 0.08);
      drawContactShadow(renderer, cluster[0], cluster[1], base * 0.42, 0.14, yaw);
      const clusterMesh = clusterMeshForEra(state.era, index);
      renderer.draw(
        clusterMesh,
        mixColor(focusColor, [1, 0.9, 0.42], 0.18),
        [cluster[0], base * 0.36, cluster[1]],
        [base * 0.52, base * 0.52, base * 0.52],
        [0, yaw + index * 0.28, 0],
        1,
        0.58,
        { skinTile: SKIN_BY_THEME[era.focus], textureBlend: 0.48, textureScale: 1.3 },
      );
      renderer.draw(
        "capsule",
        mixColor(focusColor, [0.12, 0.18, 0.2], 0.34),
        [cluster[0] + Math.cos(index) * base * 0.32, base * 0.28, cluster[1] + Math.sin(index) * base * 0.32],
        [base * 0.14, base * 0.5, base * 0.14],
        [0, yaw, 0],
        1,
        0.42,
        { skinTile: SKIN_BY_THEME[era.focus], textureBlend: 0.54 },
      );
    }
    for (const railSide of [-1, 1]) {
      const railPoint = rotateGroundPoint(x, z, yaw, railSide * base * 0.82, 0);
      renderer.draw(
        "cube",
        mixColor(focusColor, [0.12, 0.18, 0.2], 0.58),
        [railPoint[0], base * 0.07, railPoint[1]],
        [base * 0.075, base * 0.14, base * 1.55],
        [0, yaw, 0],
        1,
        0.34,
        {
          skinTile: SKIN_BY_THEME[era.focus],
          textureBlend: 0.58,
          textureScale: [1, 2.2],
        },
      );
    }
    if (index % 2 === 0) {
      const directionX = nextX - x;
      const directionZ = -base * 2.16;
      const directionLength = Math.hypot(directionX, directionZ) || 1;
      const edgeX = -directionZ / directionLength;
      const edgeZ = directionX / directionLength;
      const sides = state.lowQuality ? [index % 4 === 0 ? -1 : 1] : [-1, 1];
      for (const side of sides) {
        const isBeacon = !state.lowQuality && (index === 4 || index === 8);
        const postHeight = isBeacon ? base * 1.72 : base * 0.64;
        const postX = x + edgeX * side * base * 1.18;
        const postZ = z + edgeZ * side * base * 1.18;
        if (!state.lowQuality) {
          drawContactShadow(renderer, postX, postZ, base * 0.22, 0.12, yaw);
        }
        renderer.draw(
          state.era === 2 ? "cube" : "cylinder",
          state.era === 0
            ? [0.72, 0.5, 0.3]
            : mixColor(focusColor, [0.92, 0.95, 0.86], 0.32),
          [postX, postHeight * 0.5, postZ],
          [base * 0.16, postHeight, base * 0.16],
          [0, yaw, 0],
          1,
          0.38,
          {
            skinTile: state.era === 0 ? 1 : SKIN_BY_THEME[era.focus],
            textureBlend: 0.42,
            textureScale: [1, 1.6],
          },
        );
        renderer.draw(
          "sphere",
          [1, 0.78, 0.24],
          [postX, postHeight + base * 0.06, postZ],
          [base * 0.13, base * 0.13, base * 0.13],
          [0, 0, 0],
          1,
          0.92,
        );
        if (isBeacon) {
          renderer.draw(
            "cube",
            mixColor(focusColor, [1, 0.88, 0.4], 0.2),
            [
              postX + edgeX * -side * base * 0.3,
              postHeight - base * 0.28,
              postZ + edgeZ * -side * base * 0.3,
            ],
            [base * 0.58, base * 0.34, base * 0.08],
            [0, yaw, 0],
            1,
            0.58,
            {
              skinTile: SKIN_BY_THEME[era.focus],
              textureBlend: 0.48,
            },
          );
        }
      }
    }
  }

  const branchStart: [number, number] = [base * 1.1, -base * 5.2];
  const branchEnd: [number, number] = [half * 0.29, -half * 0.4];
  const branchCount = state.lowQuality ? 1 : 6;
  for (let index = 0; index < branchCount; index += 1) {
    const t = (index + 0.5) / branchCount;
    const nextT = Math.min(1, t + 1 / branchCount);
    const x = mix(branchStart[0], branchEnd[0], t);
    const z = mix(branchStart[1], branchEnd[1], t);
    const nextX = mix(branchStart[0], branchEnd[0], nextT);
    const nextZ = mix(branchStart[1], branchEnd[1], nextT);
    drawPathTile(
      renderer,
      x,
      z,
      base * 1.3,
      base * 1.78,
      Math.atan2(nextX - x, nextZ - z),
      pathSkin,
      mixColor(pathColor, index % 2 === 0 ? focusColor : groundEdge, index % 2 === 0 ? 0.14 : 0.08),
    );
  }

  const heroStations = state.lowQuality
    ? [[-3.8, -8.4, 0.76, 0.48] as const]
    : [
        [-4.2, -8.2, 0.82, 0.48] as const,
        [4.6, -12.4, 0.98, -0.62] as const,
      ];
  for (const [xRatio, zRatio, scaleRatio, stationYaw] of heroStations) {
    const stationX = base * xRatio;
    const stationZ = base * zRatio;
    renderer.draw(
      "cube",
      mixColor(groundEdge, focusColor, 0.2),
      [stationX, base * 0.055, stationZ],
      [base * scaleRatio * 2.8, base * 0.11, base * scaleRatio * 2.3],
      [0, stationYaw, 0],
      1,
      0.16,
      {
        skinTile: groundSkin,
        textureBlend: 0.68,
        textureScale: [2.4, 2],
      },
    );
    drawEraLandmark(
      renderer,
      state.era,
      stationX,
      stationZ,
      base * scaleRatio,
      stationYaw,
      time,
    );
  }

  if (!state.lowQuality) {
    drawEraDressingIsland(
      renderer,
      state,
      -half * 0.29,
      -half * 0.1,
      base * 1.46,
      time,
      0.54,
    );
    drawEraDressingIsland(
      renderer,
      state,
      half * 0.31,
      -half * 0.13,
      base * 1.42,
      time,
      -0.72,
    );
  }

  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);

  const hillCount = state.lowQuality ? 2 : 13;
  for (let hillIndex = 0; hillIndex < hillCount; hillIndex += 1) {
    const angle = (hillIndex / hillCount) * Math.PI * 2 + state.era * 0.21;
    const distance = half * mix(1.02, 1.13, (hillIndex % 3) / 2);
    const hillScale = base * mix(1.8, 3.7, ((hillIndex * 7) % 11) / 10);
    renderer.draw(
      hillIndex % 2 === 0 ? "cone" : "sphere",
      mixColor(groundEdge, era.sky, 0.34),
      [Math.cos(angle) * distance, hillScale * 0.43, Math.sin(angle) * distance],
      [hillScale * 1.5, hillScale, hillScale * 1.2],
      [0, -angle, 0],
      state.lowQuality ? 1 : 0.62,
      0.08,
      { skinTile: groundSkin, textureBlend: 0.18, textureScale: 2.2 },
    );
  }

  const cloudCount = state.lowQuality ? 0 : 4;
  for (let cloudIndex = 0; cloudIndex < cloudCount; cloudIndex += 1) {
    const cloudT = cloudCount <= 1 ? 0.55 : cloudIndex / (cloudCount - 1);
    const side = (cloudT - 0.5) * half * 1.02;
    const drift = state.reducedMotion ? 0 : Math.sin(time * 0.09 + cloudIndex * 2.1) * base * 0.7;
    drawCloud(
      renderer,
      state.x + forwardX * half * mix(0.58, 0.9, cloudT) + rightX * (side + drift),
      base * (4.85 + (cloudIndex % 2) * 0.9),
      state.z + forwardZ * half * mix(0.58, 0.9, cloudT) + rightZ * (side + drift),
      base * mix(0.52, 0.78, (cloudIndex % 3) / 2),
      0.34,
    );
  }

  const random = seededRandom(4400 + state.era * 811);
  if (!state.lowQuality) {
    const detailRandom = seededRandom(8800 + state.era * 977);
    for (let index = 0; index < 30; index += 1) {
      const detailX = (detailRandom() - 0.5) * half * 1.32;
      const detailZ = -base * 2.8 - detailRandom() * half * 0.66;
      if (Math.hypot(detailX, detailZ) < base * 4.2) continue;
      const detailSize = base * mix(0.09, 0.22, detailRandom());
      const detailShape = detailShapeForIndex(index);
      renderer.draw(
        detailShape,
        mixColor(focusColor, groundEdge, 0.42 + (index % 3) * 0.09),
        [detailX, detailSize * 0.5, detailZ],
        [detailSize, detailSize * mix(0.65, 1.7, detailRandom()), detailSize],
        [0, detailRandom() * Math.PI * 2, 0],
        1,
        0.32,
        {
          skinTile: SKIN_BY_THEME[era.focus],
          textureBlend: 0.68,
          textureScale: 1.2,
        },
      );
    }
  }
  const propCount = state.lowQuality ? 1 : 18;
  for (let index = 0; index < propCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = half * mix(0.46, 0.72, Math.sqrt(random()));
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const scale = base * mix(0.44, 0.82, random());
    if (state.era === 0 || state.era === 4) {
      if (index % 3 !== 0) {
        drawToyTree(renderer, x, z, scale, time, angle);
      } else {
        if (!state.lowQuality) drawContactShadow(renderer, x, z, scale * 0.75, 0.13, angle);
        renderer.draw("sphere", [0.9, 0.65, 0.45], [x, scale * 0.34, z], [scale * 1.1, scale * 0.68, scale * 0.9], [0, angle, 0], 1, 0.12, { skinTile: 2, textureBlend: 0.68, textureScale: 1.4 });
      }
    } else if (state.era === 1) {
      if (!state.lowQuality) drawContactShadow(renderer, x, z, scale * 0.82, 0.15, angle);
      renderer.draw("cube", [1, 0.78, 0.33], [x, scale * 0.34, z], [scale * 1.45, scale * 0.62, scale * 0.92], [0, angle, 0], 1, 0.34, { skinTile: index % 2 === 0 ? 3 : 2, textureBlend: 0.82, textureScale: [1.6, 1] });
      const conePoint = rotateGroundPoint(x, z, angle, scale * 0.38, 0);
      renderer.draw("cone", [1, 0.88, 0.48], [conePoint[0], scale * 0.82, conePoint[1]], [scale * 0.28, scale * 0.68, scale * 0.28], [0, angle, 0], 1, 0.45, { skinTile: 3, textureBlend: 0.68 });
    } else if (state.era === 2) {
      if (!state.lowQuality) drawContactShadow(renderer, x, z, scale * 0.9, 0.15, angle);
      renderer.draw("cube", [0.72, 0.9, 1], [x, scale * 0.44, z], [scale * 1.7, scale * 0.82, scale], [0, angle, 0], 1, 0.42, { skinTile: 4, textureBlend: 0.88, textureScale: [2, 1] });
      renderer.draw("cube", [0.94, 0.98, 1], [x, scale * 0.94, z], [scale * 1.1, scale * 0.12, scale * 0.72], [0, angle, 0], state.lowQuality ? 1 : 0.9, 0.85, { skinTile: 7, textureBlend: 0.42 });
    } else {
      if (!state.lowQuality) drawContactShadow(renderer, x, z, scale * 0.68, 0.15, angle);
      renderer.draw("cube", [0.48, 0.64, 0.94], [x, scale * 0.72, z], [scale * 0.86, scale * 1.42, scale * 0.72], [0, angle, 0], 1, 0.68, { skinTile: 5, textureBlend: 0.94, textureScale: [1, 1.8] });
      renderer.draw("sphere", [0.28, 0.9, 1], [x, scale * 1.56, z], [scale * 0.2, scale * 0.2, scale * 0.2], [0, 0, 0], state.lowQuality ? 1 : 0.92, 0.96);
    }
  }

  const landmarkCount = state.lowQuality ? 2 : 13;
  for (let index = 0; index < landmarkCount; index += 1) {
    const angle = (index / landmarkCount) * Math.PI * 2 + (random() - 0.5) * 0.16;
    const distanceBand = [0.78, 0.89, 0.98][index % 3];
    const distance = half * (distanceBand + random() * 0.025);
    drawEraLandmark(
      renderer,
      state.era,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      base * mix(0.7, 1.18, random()),
      -angle + Math.PI / 2,
      time,
    );
  }

  const setPieceX = half * 0.31;
  const setPieceZ = -half * 0.42;
  const setPieceYaw = state.era === 0 ? -0.92 : -0.38;
  renderer.draw(
    "cube",
    mixColor(groundEdge, focusColor, 0.16),
    [setPieceX, base * 0.08, setPieceZ],
    [base * 5.72, base * 0.16, base * 4.66],
    [0, setPieceYaw, 0],
    1,
    0.16,
  );
  renderer.draw(
    "cube",
    mixColor(groundLight, focusColor, 0.24),
    [setPieceX, base * 0.19, setPieceZ],
    [base * 5.42, base * 0.08, base * 4.36],
    [0, setPieceYaw, 0],
    1,
    0.22,
    {
      skinTile: groundSkin,
      textureBlend: 0.7,
      textureScale: [4.8, 4.1],
    },
  );
  drawEraLandmark(
    renderer,
    state.era,
    setPieceX,
    setPieceZ,
    base * 1.95,
    setPieceYaw,
    time,
  );
  drawEraImageGallery(
    renderer,
    state,
    camera,
    setPieceX,
    setPieceZ,
    base,
    setPieceYaw,
  );
  for (const side of [-1, 1]) {
    const cratePoint = rotateGroundPoint(
      setPieceX,
      setPieceZ,
      setPieceYaw,
      side * base * 1.7,
      base * 1.15,
    );
    const crateX = cratePoint[0];
    const crateZ = cratePoint[1];
    if (!state.lowQuality) {
      drawContactShadow(renderer, crateX, crateZ, base * 0.65, 0.16, setPieceYaw + side * 0.24);
    }
    renderer.draw(
      state.era === 0 || state.era === 4 ? "cylinder" : "cube",
      mixColor(focusColor, [1, 0.84, 0.42], 0.28),
      [crateX, base * 0.42, crateZ],
      [base * 0.9, base * 0.82, base * 0.9],
      [0, setPieceYaw + side * 0.24, 0],
      1,
      0.4,
      {
        skinTile: SKIN_BY_THEME[era.focus],
        textureBlend: 0.5,
        textureScale: 1.25,
      },
    );
  }

  if (!state.lowQuality) {
    const foregroundAnchors = [
      [-0.43, -0.27, 1.48, 0.42],
      [0.48, -0.07, 1.28, -0.92],
    ] as const;
    for (const [xRatio, zRatio, scaleRatio, yaw] of foregroundAnchors) {
      const anchorX = half * xRatio;
      const anchorZ = half * zRatio;
      renderer.draw(
        "cube",
        mixColor(groundEdge, focusColor, 0.18),
        [anchorX, base * 0.065, anchorZ],
        [base * scaleRatio * 2.78, base * 0.13, base * scaleRatio * 2.34],
        [0, yaw, 0],
        1,
        0.14,
      );
      renderer.draw(
        "cube",
        mixColor(groundCenter, focusColor, 0.22),
        [anchorX, base * 0.15, anchorZ],
        [base * scaleRatio * 2.52, base * 0.06, base * scaleRatio * 2.08],
        [0, yaw, 0],
        1,
        0.2,
      );
      drawEraLandmark(
        renderer,
        state.era,
        anchorX,
        anchorZ,
        base * scaleRatio,
        yaw,
        time,
      );
    }
  }
}

function drawItem(
  renderer: WebGlToyRenderer,
  item: Collectible,
  time: number,
  lowQuality: boolean,
  focusTheme: ThemeId,
  camera: CameraState,
  lod: ItemRenderLod = "full",
  drawShadow = true,
) {
  const theme = THEME_BY_ID[item.theme];
  const isFocus = item.theme === focusTheme;
  const variant = item.objectKind % OBJECT_VARIANTS_PER_THEME;
  const imageFamily = variant % OBJECT_GEOMETRY_FAMILY_COUNT;
  const valueScale = 1 + (variant % 5) * 0.035 + (variant >= 5 ? 0.1 : 0);
  const visualScale = (item.special ? 1.08 : isFocus ? 1.3 : 1.1) * valueScale;
  const r = item.r * visualScale;
  const color = isFocus
    ? mixColor(theme.color, [1, 0.92, 0.7], 0.05)
    : mixColor(theme.color, [0.64, 0.68, 0.66], 0.16);
  const bob = item.special
    ? Math.sin(time * 1.2) * r * 0.05
    : Math.sin(time * 1.45 + item.id * 0.73) * r * 0.025;
  const y = r * 0.52 + bob;
  if (drawShadow) {
    drawContactShadow(renderer, item.x, item.z, r * 0.8, item.special ? 0.26 : 0.2, item.yaw);
  }

  if (lod === "simple" && !item.special) {
    const simpleShape = simpleItemShape(imageFamily, item.theme, item.shape);
    if (isFocus && !lowQuality) {
      renderer.draw(
        "cylinder",
        mixColor(theme.color, [1, 0.9, 0.45], 0.18),
        [item.x, r * 0.026, item.z],
        [r * 1.28, r * 0.028, r * 1.28],
        [0, item.yaw, 0],
        0.28,
        0.82,
      );
    }
    renderer.draw(
      simpleShape,
      color,
      [item.x, y + r * 0.1, item.z],
      [r * 0.82, r * 1.05, r * 0.82],
      [0, item.yaw, 0],
      1,
      0.52,
      {
        skinTile: SKIN_BY_THEME[item.theme],
        textureBlend: 0.72,
        textureScale: 1.2,
      },
    );
    return;
  }

  renderer.draw(
    "torus",
    mixColor(theme.color, [1, 0.9, 0.45], 0.18),
    [item.x, r * 0.032, item.z],
    [r * (isFocus ? 1.72 : 1.42), r * (isFocus ? 1.72 : 1.42), r * (isFocus ? 1.72 : 1.42)],
    [0, item.yaw, 0],
    isFocus ? 0.42 : 0.18,
    0.88,
  );
  if (item.special) {
    renderer.draw(
      "kenneyCog",
      [1.0, 0.84, 0.28],
      [item.x, r * 2.08 + bob, item.z],
      [r * 0.38, r * 0.38, r * 0.38],
      [Math.PI / 2, item.yaw + time * 0.3, 0],
      0.9,
      1,
    );
  } else if (isFocus) {
    const glint = 0.82 + Math.sin(time * 2.4 + item.id) * 0.08;
    renderer.draw(
      "sphere",
      [1, 0.88, 0.32],
      [item.x, y + r * 1.05, item.z],
      [r * 0.13 * glint, r * 0.21 * glint, r * 0.13 * glint],
      [0, time, 0],
      0.92,
      1,
    );
  }

  const drawDecal = (height = 0.3, size = 1, offset = 0.08) => {
    if (!item.special) return;
    if (lowQuality) return;
    const toCameraX = camera.eye[0] - item.x;
    const toCameraZ = camera.eye[2] - item.z;
    const length = Math.hypot(toCameraX, toCameraZ) || 1;
    const dirX = toCameraX / length;
    const dirZ = toCameraZ / length;
    const markerYaw = Math.atan2(dirX, dirZ);
    renderer.draw(
      "roundedBox",
      mixColor(color, [1, 0.9, 0.46], 0.2),
      [
        item.x + dirX * r * Math.max(offset, 0.18),
        y + r * height,
        item.z + dirZ * r * Math.max(offset, 0.18),
      ],
      [r * size * 0.34, r * size * 0.22, r * 0.16],
      [0, markerYaw, 0],
      0.92,
      0.78,
      {
        skinTile: SKIN_BY_THEME[item.theme],
        textureBlend: 0.76,
        textureScale: [1.1, 0.8],
      },
    );
  };

  const itemPosition = (localX: number, height: number, localZ: number): Vec3 => {
    const point = rotateGroundPoint(item.x, item.z, item.yaw, localX * r, localZ * r);
    return [point[0], height, point[1]];
  };

  const wheel = (localX: number, localZ: number, size = 0.22) => {
    const point = rotateGroundPoint(item.x, item.z, item.yaw, localX * r, localZ * r);
    renderer.draw("cylinder", [0.15, 0.17, 0.19], [point[0], r * 0.24, point[1]], [r * size, r * 0.18, r * size], [Math.PI / 2, item.yaw, 0], 1, 0.28);
  };

  if (item.special && item.theme === "life") {
    renderer.draw("cylinder", color, [item.x, r * 0.23, item.z], [r * 1.65, r * 0.35, r * 1.65], [0, 0, 0], 1, 0.38, { skinTile: 6, textureBlend: 0.78, textureScale: 1.6 });
    renderer.draw("sphere", [0.72, 0.96, 0.9], [item.x, r * 0.62, item.z], [r * 2.08, r * 1.25, r * 2.08], [0, time * 0.08, 0], 0.66, 0.96, { skinTile: 7, textureBlend: 0.94, textureScale: 1.4 });
    const ribCount = lowQuality ? 4 : 8;
    for (let index = 0; index < ribCount; index += 1) {
      const angle = (index / ribCount) * Math.PI * 2;
      renderer.draw(
        "cylinder",
        [0.88, 0.95, 0.81],
        [item.x + Math.cos(angle) * r * 1.22, r * 0.69, item.z + Math.sin(angle) * r * 1.22],
        [r * 0.07, r * 0.92, r * 0.07],
        [0, 0, 0],
        0.84,
        0.45,
        { skinTile: 8, textureBlend: 0.48, textureScale: [1, 2] },
      );
      renderer.draw(
        "sphere",
        [0.18, 0.68, 0.42],
        [item.x + Math.cos(angle) * r * 0.88, r * 0.58, item.z + Math.sin(angle) * r * 0.88],
        [r * 0.32, r * 0.48, r * 0.32],
        [0, angle, 0],
        1,
        0.28,
        { skinTile: 6, textureBlend: 0.74 },
      );
    }
    renderer.draw("sphere", [0.98, 0.78, 0.25], [item.x, r * 1.7, item.z], [r * 0.22, r * 0.22, r * 0.22], [0, 0, 0], 1, 0.9);
    drawDecal(0.48, 1.18, 0.16);
    return;
  }

  if (item.theme === "manufacturing" && imageFamily === 0) {
    const spin = item.yaw + time * 0.14;
    renderer.draw("cylinder", [1, 0.9, 0.7], [item.x, y, item.z], [r * 1.12, r * 0.62, r * 1.12], [0, spin, 0], 1, 0.48, { skinTile: 1, textureBlend: 0.66, textureScale: 1.4 });
    const toothCount = lowQuality ? 4 : variant >= 5 ? 10 : 8;
    for (let tooth = 0; tooth < toothCount; tooth += 1) {
      const angle = spin + (tooth / toothCount) * Math.PI * 2;
      renderer.draw(
        "cube",
        mixColor(color, [1, 0.9, 0.48], 0.18),
        [item.x + Math.cos(angle) * r * 0.62, y, item.z + Math.sin(angle) * r * 0.62],
        [r * 0.28, r * 0.22, r * 0.18],
        [0, -angle, 0],
        1,
        0.35,
        { skinTile: 1, textureBlend: 0.56 },
      );
    }
    renderer.draw("cylinder", [0.98, 0.92, 0.72], [item.x, y + r * 0.42, item.z], [r * 0.31, r * 0.55, r * 0.31], [0, 0, 0], 1, 0.58, { skinTile: 8, textureBlend: 0.5 });
    if (variant >= 5) renderer.draw("sphere", [1, 0.58, 0.28], [item.x, y + r * 0.72, item.z], [r * 0.18, r * 0.18, r * 0.18], [0, 0, 0], 1, 0.88);
    drawDecal(0.2, 0.82);
  } else if (item.theme === "manufacturing" && imageFamily === 1) {
    renderer.draw(
      "cylinder",
      [0.86, 0.68, 0.42],
      [item.x, y, item.z],
      [r * 0.24, r * 1.48, r * 0.24],
      [0, item.yaw, -0.58],
      1,
      0.24,
      { skinTile: 1, textureBlend: 0.58, textureScale: [1, 2.2] },
    );
    renderer.draw(
      "cube",
      [0.96, 0.76, 0.34],
      itemPosition(Math.sin(0.58) * 0.68, y + Math.cos(0.58) * r * 0.68, 0),
      [r * 0.92, r * 0.38, r * 0.48],
      [0, item.yaw, -0.2],
      1,
      0.58,
      { skinTile: 0, textureBlend: 0.42, textureScale: [1.4, 1] },
    );
    if (variant >= 5) renderer.draw("cylinder", [0.9, 0.26, 0.18], itemPosition(0.34, y - r * 0.48, 0), [r * 0.18, r * 0.5, r * 0.18], [0, item.yaw, 0.32], 1, 0.46);
    drawDecal(0.2, 0.86);
  } else if (item.theme === "manufacturing" && imageFamily === 2) {
    renderer.draw(
      "cylinder",
      [0.96, 0.82, 0.54],
      [item.x, y - r * 0.12, item.z],
      [r * 0.88, r * 0.92, r * 0.88],
      [0, item.yaw, 0],
      1,
      0.34,
      { skinTile: 1, textureBlend: 0.56, textureScale: 1.5 },
    );
    renderer.draw("cylinder", [1, 0.92, 0.7], [item.x, y + r * 0.5, item.z], [r * 1.12, r * 0.16, r * 1.12], [0, item.yaw, 0], 1, 0.52, { skinTile: 8, textureBlend: 0.32 });
    renderer.draw("cylinder", [0.74, 0.48, 0.3], [item.x, y + r * 0.7, item.z], [r * 0.2, r * 0.52, r * 0.2], [0, item.yaw, 0], 1, 0.28, { skinTile: 1, textureBlend: 0.46 });
    if (variant >= 5) renderer.draw("cube", [0.98, 0.42, 0.22], itemPosition(0, y + r * 0.42, 0.42), [r * 0.26, r * 0.86, r * 0.24], [0, item.yaw, 0.5], 1, 0.52);
    drawDecal(0.12, 0.9);
  } else if (item.theme === "manufacturing" && imageFamily === 3) {
    renderer.draw("cylinder", [0.92, 0.34, 0.22], [item.x, y + r * 0.08, item.z], [r * 0.56, r * 1.05, r * 0.56], [Math.PI / 2, item.yaw, 0], 1, 0.62, { skinTile: 0, textureBlend: 0.58 });
    renderer.draw("sphere", [0.74, 0.44, 0.22], itemPosition(0, y - r * 0.12, 0.56), [r * 0.6, r * 0.42, r * 0.6], [0, item.yaw, 0], 1, 0.24, { skinTile: 1, textureBlend: 0.55 });
    renderer.draw("cylinder", [0.92, 0.76, 0.5], itemPosition(0, y + r * 0.56, -0.4), [r * 0.12, r * 0.74, r * 0.12], [0, item.yaw, 0], 1, 0.44);
    if (variant >= 5) renderer.draw("sphere", [0.98, 0.82, 0.3], itemPosition(0, y + r * 0.96, -0.4), [r * 0.16, r * 0.16, r * 0.16], [0, item.yaw, 0], 1, 0.92);
    drawDecal(0.18, 0.86);
  } else if (item.theme === "manufacturing") {
    renderer.draw("cube", [0.92, 0.24, 0.18], [item.x, y, item.z], [r * 1.34, r * 0.46, r * 0.56], [0, item.yaw, 0], 1, 0.62, { skinTile: 0, textureBlend: 0.5 });
    renderer.draw("cylinder", [0.22, 0.22, 0.23], itemPosition(-0.48, y - r * 0.04, 0), [r * 0.14, r * 0.78, r * 0.14], [0, item.yaw, Math.PI / 2], 1, 0.26);
    renderer.draw("cylinder", [0.22, 0.22, 0.23], itemPosition(0.48, y - r * 0.04, 0), [r * 0.14, r * 0.78, r * 0.14], [0, item.yaw, Math.PI / 2], 1, 0.26);
    if (variant >= 5) renderer.draw("sphere", [0.96, 0.78, 0.42], [item.x, y + r * 0.42, item.z], [r * 0.22, r * 0.22, r * 0.22], [0, 0, 0], 1, 0.86);
    drawDecal(0.24, 0.82);
  } else if (item.theme === "construction" && imageFamily === 0) {
    renderer.draw("cube", [1, 0.88, 0.48], [item.x, y, item.z], [r * 1.36, r * 0.84, r * 1.02], [0, item.yaw, 0], 1, 0.36, { skinTile: 3, textureBlend: 0.68, textureScale: [1.4, 1] });
    for (const side of [-0.32, 0.32]) {
      const stud = rotateGroundPoint(item.x, item.z, item.yaw, side * r, -r * 0.2);
      renderer.draw("cylinder", [0.98, 0.9, 0.62], [stud[0], y + r * 0.51, stud[1]], [r * 0.18, r * 0.22, r * 0.18], [0, 0, 0], 1, 0.52, { skinTile: 3, textureBlend: 0.52 });
    }
    renderer.draw("cube", [0.74, 0.42, 0.28], [item.x, y - r * 0.08, item.z], [r * 1.46, r * 0.08, r * 1.12], [0, item.yaw, 0], 0.66, 0.2, { skinTile: 2, textureBlend: 0.6, textureScale: [1.4, 1] });
    if (variant >= 5) renderer.draw("cube", [0.92, 0.58, 0.25], [item.x, y + r * 0.66, item.z], [r * 1.08, r * 0.18, r * 0.18], [0, item.yaw, 0], 1, 0.36);
    drawDecal(0.25, 0.88);
  } else if (item.theme === "construction" && imageFamily === 1) {
    renderer.draw("sphere", [1, 0.84, 0.3], [item.x, y + r * 0.12, item.z], [r * 1.18, r * 0.78, r * 1.18], [0, item.yaw, 0], 1, 0.48, { skinTile: 3, textureBlend: 0.52, textureScale: 1.3 });
    renderer.draw("cylinder", [1, 0.9, 0.52], [item.x, y - r * 0.12, item.z], [r * 1.48, r * 0.14, r * 1.48], [0, item.yaw, 0], 1, 0.52, { skinTile: 3, textureBlend: 0.42 });
    renderer.draw("cube", [0.88, 0.58, 0.24], [item.x, y + r * 0.66, item.z], [r * 0.18, r * 0.34, r * 0.66], [0, item.yaw, 0], 1, 0.36, { skinTile: 2, textureBlend: 0.42 });
    if (variant >= 5) renderer.draw("cube", [1, 0.95, 0.55], itemPosition(-0.34, y + r * 0.18, 0), [r * 0.22, r * 0.42, r * 0.22], [0, item.yaw, 0], 1, 0.5);
    drawDecal(0.16, 0.9);
  } else if (item.theme === "construction" && imageFamily === 2) {
    for (const side of [-0.42, 0.42]) {
      const rail = rotateGroundPoint(item.x, item.z, item.yaw, side * r, 0);
      renderer.draw("cube", [1, 0.82, 0.34], [rail[0], y + r * 0.22, rail[1]], [r * 0.16, r * 1.55, r * 0.16], [0, item.yaw, 0], 1, 0.42, { skinTile: 3, textureBlend: 0.5, textureScale: [1, 2] });
    }
    const rungCount = lowQuality ? 3 : 5;
    for (let rung = 0; rung < rungCount; rung += 1) {
      renderer.draw("cube", [0.92, 0.64, 0.27], [item.x, y - r * 0.42 + rung * r * 0.31, item.z], [r * 1.02, r * 0.1, r * 0.14], [0, item.yaw, 0], 1, 0.34, { skinTile: 2, textureBlend: 0.42 });
    }
    if (variant >= 5) renderer.draw("sphere", [0.22, 0.22, 0.22], [item.x, y + r * 0.66, item.z], [r * 0.12, r * 0.12, r * 0.12], [0, 0, 0], 1, 0.8);
    drawDecal(0.22, 0.86);
  } else if (item.theme === "construction" && imageFamily === 3) {
    renderer.draw("cube", [0.94, 0.7, 0.24], [item.x, y, item.z], [r * 0.74, r * 0.74, r * 0.74], [0, item.yaw, 0], 1, 0.45, { skinTile: 3, textureBlend: 0.62 });
    renderer.draw("cylinder", [0.18, 0.18, 0.19], [item.x, y - r * 0.58, item.z], [r * 0.18, r * 0.72, r * 0.18], [0, 0, 0], 1, 0.28);
    renderer.draw("cone", [0.12, 0.12, 0.12], [item.x, y - r * 1.02, item.z], [r * 0.46, r * 0.42, r * 0.46], [0, item.yaw, 0], 1, 0.25);
    if (variant >= 5) renderer.draw("sphere", [1, 0.78, 0.25], itemPosition(0.36, y + r * 0.28, 0), [r * 0.14, r * 0.14, r * 0.14], [0, item.yaw, 0], 1, 0.9);
    drawDecal(0.18, 0.86);
  } else if (item.theme === "construction") {
    renderer.draw("cylinder", [0.96, 0.76, 0.28], [item.x, y, item.z], [r * 0.64, r * 1.08, r * 0.64], [Math.PI / 2, item.yaw, 0], 1, 0.38, { skinTile: 3, textureBlend: 0.48 });
    renderer.draw("cube", [0.68, 0.68, 0.62], [item.x, y - r * 0.34, item.z], [r * 1.42, r * 0.16, r * 0.7], [0, item.yaw, 0], 1, 0.24);
    if (variant >= 5) renderer.draw("cube", [0.98, 0.54, 0.22], [item.x, y + r * 0.48, item.z], [r * 0.32, r * 0.2, r * 0.82], [0, item.yaw, 0], 1, 0.52);
    drawDecal(0.16, 0.88);
  } else if (item.theme === "transport" && imageFamily === 0) {
    renderer.draw("cube", [0.72, 0.88, 1], [item.x, y, item.z], [r * 1.68, r * 0.58, r * 1.02], [0, item.yaw, 0], 1, 0.48, { skinTile: 4, textureBlend: 0.68, textureScale: [1.7, 1] });
    renderer.draw("cube", [0.72, 0.98, 1], [item.x, y + r * 0.44, item.z], [r * 0.78, r * 0.38, r * 0.86], [0, item.yaw, 0], 0.94, 0.9, { skinTile: 7, textureBlend: 0.52 });
    for (const sideX of [-0.58, 0.58]) {
      for (const sideZ of lowQuality ? [-0.42] : [-0.42, 0.42]) {
        const wheel = rotateGroundPoint(item.x, item.z, item.yaw, sideX * r, sideZ * r);
        renderer.draw("cylinder", [0.18, 0.2, 0.22], [wheel[0], r * 0.24, wheel[1]], [r * 0.29, r * 0.2, r * 0.29], [Math.PI / 2, item.yaw, 0], 1, 0.24, { skinTile: 4, textureBlend: 0.42 });
      }
    }
    if (variant >= 5) renderer.draw("cube", [0.94, 0.98, 1], itemPosition(0, y + r * 0.76, -0.12), [r * 0.38, r * 0.18, r * 0.5], [0, item.yaw, 0], 1, 0.7);
    drawDecal(0.26, 0.9);
  } else if (item.theme === "transport" && imageFamily === 1) {
    renderer.draw("cylinder", [0.16, 0.22, 0.28], [item.x, y, item.z], [r * 1.08, r * 0.34, r * 1.08], [Math.PI / 2, item.yaw, 0], 1, 0.28, { skinTile: 4, textureBlend: 0.48, textureScale: 1.3 });
    renderer.draw("cylinder", [0.46, 0.84, 1], itemPosition(0, y, -0.22), [r * 0.54, r * 0.4, r * 0.54], [Math.PI / 2, item.yaw, 0], 1, 0.62, { skinTile: 4, textureBlend: 0.52 });
    renderer.draw("sphere", [1, 0.78, 0.28], itemPosition(0, y, -0.46), [r * 0.18, r * 0.18, r * 0.12], [0, item.yaw, 0], 1, 0.86);
    if (variant >= 5) renderer.draw("cube", [0.54, 0.94, 1], itemPosition(0, y + r * 0.1, 0.34), [r * 0.26, r * 0.62, r * 0.16], [0, item.yaw, 0], 1, 0.7);
    drawDecal(0.12, 0.88);
  } else if (item.theme === "transport" && imageFamily === 2) {
    renderer.draw("cube", [0.42, 0.78, 0.98], [item.x, y - r * 0.02, item.z], [r * 1.72, r * 0.7, r * 0.9], [0, item.yaw, 0], 1, 0.48, { skinTile: 4, textureBlend: 0.58, textureScale: [1.8, 1] });
    renderer.draw("cylinder", [0.88, 0.95, 1], [item.x, y + r * 0.58, item.z], [r * 0.36, r * 0.62, r * 0.36], [0, item.yaw, 0], 1, 0.62, { skinTile: 7, textureBlend: 0.4 });
    renderer.draw("sphere", [0.98, 0.8, 0.28], [item.x, y + r * 0.96, item.z], [r * 0.18, r * 0.18, r * 0.18], [0, 0, 0], 1, 0.9);
    for (const side of [-0.56, 0.56]) wheel(side, 0.38, 0.22);
    if (variant >= 5) renderer.draw("cube", [0.1, 0.14, 0.18], [item.x, y - r * 0.42, item.z], [r * 1.35, r * 0.12, r * 0.25], [0, item.yaw, 0], 1, 0.25);
    drawDecal(0.28, 0.9);
  } else if (item.theme === "transport" && imageFamily === 3) {
    renderer.draw("cube", [0.9, 0.96, 1], [item.x, y, item.z], [r * 1.52, r * 0.42, r * 1.18], [0, item.yaw, 0], 1, 0.72, { skinTile: 7, textureBlend: 0.42 });
    renderer.draw("cube", [0.26, 0.72, 0.96], itemPosition(-0.78, y - r * 0.02, 0), [r * 0.58, r * 0.08, r * 0.18], [0, item.yaw, 0], 1, 0.62);
    renderer.draw("cube", [0.26, 0.72, 0.96], itemPosition(0.78, y - r * 0.02, 0), [r * 0.58, r * 0.08, r * 0.18], [0, item.yaw, 0], 1, 0.62);
    renderer.draw("cone", [0.22, 0.62, 0.9], itemPosition(0, y + r * 0.56, 0.45), [r * 0.22, r * 0.46, r * 0.22], [0, item.yaw, 0], 1, 0.65);
    if (variant >= 5) renderer.draw("sphere", [1, 0.8, 0.25], itemPosition(0, y - r * 0.18, -0.68), [r * 0.16, r * 0.16, r * 0.16], [0, item.yaw, 0], 1, 0.9);
    drawDecal(0.18, 0.9);
  } else if (item.theme === "transport") {
    renderer.draw("sphere", [0.16, 0.62, 0.9], [item.x, y, item.z], [r * 0.85, r * 0.48, r * 0.85], [0, item.yaw, 0], 1, 0.7, { skinTile: 4, textureBlend: 0.6 });
    for (let arm = 0; arm < (lowQuality ? 2 : 4); arm += 1) {
      const angle = item.yaw + arm * Math.PI / 2;
      renderer.draw("cube", [0.1, 0.14, 0.18], [item.x + Math.cos(angle) * r * 0.7, y, item.z + Math.sin(angle) * r * 0.7], [r * 1.05, r * 0.06, r * 0.12], [0, -angle, 0], 1, 0.5);
      renderer.draw("sphere", [0.08, 0.1, 0.12], [item.x + Math.cos(angle) * r * 1.16, y, item.z + Math.sin(angle) * r * 1.16], [r * 0.22, r * 0.05, r * 0.22], [0, -angle, 0], 1, 0.32);
    }
    if (variant >= 5) renderer.draw("sphere", [0.2, 0.88, 1], [item.x, y + r * 0.34, item.z], [r * 0.28, r * 0.16, r * 0.28], [0, 0, 0], 1, 0.95);
    drawDecal(0.18, 0.9);
  } else if (item.theme === "communication" && imageFamily === 0) {
    renderer.draw("cone", [0.58, 0.72, 1], [item.x, y, item.z], [r * 0.78, r * 1.38, r * 0.78], [0, item.yaw, 0], 1, 0.62, { skinTile: 5, textureBlend: 0.68, textureScale: [1, 1.8] });
    renderer.draw("cylinder", [0.4, 0.68, 0.92], [item.x, y + r * 0.72, item.z], [r * 0.11, r * 0.75, r * 0.11], [0, 0, 0], 1, 0.7, { skinTile: 5, textureBlend: 0.58, textureScale: [1, 2] });
    const signalCount = lowQuality ? 1 : 3;
    for (let signal = 0; signal < signalCount; signal += 1) {
      const angle = time * 1.5 + signal * (Math.PI * 2 / signalCount) + item.yaw;
      renderer.draw(
        "sphere",
        [0.98, 0.88, 0.34],
        [item.x + Math.cos(angle) * r * 0.42, y + r * (0.92 + signal * 0.1), item.z + Math.sin(angle) * r * 0.42],
        [r * 0.13, r * 0.13, r * 0.13],
        [0, 0, 0],
        1,
        0.92,
      );
    }
    if (variant >= 5) renderer.draw("sphere", [0.42, 0.94, 1], [item.x, y + r * 1.28, item.z], [r * 0.12, r * 0.12, r * 0.12], [0, 0, 0], 1, 0.95);
    drawDecal(0.16, 0.84);
  } else if (item.theme === "communication" && imageFamily === 1) {
    renderer.draw("cube", [0.42, 0.62, 0.94], [item.x, y, item.z], [r * 1.02, r * 1.34, r * 0.62], [0, item.yaw, 0], 1, 0.7, { skinTile: 5, textureBlend: 0.62, textureScale: [1.2, 1.6] });
    renderer.draw("cube", [0.54, 0.94, 1], itemPosition(0, y + r * 0.08, -0.34), [r * 0.7, r * 0.62, r * 0.08], [0, item.yaw, 0], 0.92, 0.95, { skinTile: 7, textureBlend: 0.4 });
    for (const row of [-0.26, 0.18, 0.56]) {
      renderer.draw("sphere", [1, 0.82, 0.28], itemPosition(-0.32, y + r * row, -0.4), [r * 0.07, r * 0.07, r * 0.05], [0, item.yaw, 0], 1, 0.92);
    }
    if (variant >= 5) renderer.draw("cube", [0.22, 0.26, 0.38], itemPosition(0.38, y + r * 0.44, 0), [r * 0.16, r * 0.24, r * 0.16], [0, item.yaw, 0], 1, 0.8);
    drawDecal(0.18, 0.86);
  } else if (item.theme === "communication" && imageFamily === 2) {
    renderer.draw("cylinder", [0.46, 0.64, 0.94], [item.x, y - r * 0.38, item.z], [r * 0.18, r * 0.82, r * 0.18], [0, item.yaw, 0], 1, 0.64, { skinTile: 5, textureBlend: 0.52 });
    renderer.draw("cone", [0.66, 0.86, 1], [item.x, y + r * 0.38, item.z], [r * 0.92, r * 0.42, r * 0.92], [Math.PI / 2, item.yaw, 0], 0.96, 0.86, { skinTile: 7, textureBlend: 0.38 });
    renderer.draw("sphere", [1, 0.82, 0.26], [item.x, y + r * 0.76, item.z], [r * 0.17, r * 0.17, r * 0.17], [0, 0, 0], 1, 0.94);
    if (variant >= 5) renderer.draw("sphere", [0.42, 0.9, 1], [item.x, y + r * 0.4, item.z], [r * 0.52, r * 0.08, r * 0.52], [Math.PI / 2, 0, 0], 0.65, 0.9);
    drawDecal(0.12, 0.86);
  } else if (item.theme === "communication" && imageFamily === 3) {
    renderer.draw("cube", [0.48, 0.28, 0.82], [item.x, y, item.z], [r * 0.78, r * 1.16, r * 0.68], [0, item.yaw, 0], 1, 0.86, { skinTile: 5, textureBlend: 0.5 });
    renderer.draw("cylinder", [0.68, 0.56, 0.9], [item.x, y + r * 0.62, item.z], [r * 0.52, r * 0.16, r * 0.52], [Math.PI / 2, item.yaw, 0], 1, 0.8);
    if (variant >= 5) renderer.draw("sphere", [0.36, 0.98, 0.36], itemPosition(0.34, y + r * 0.06, -0.38), [r * 0.08, r * 0.08, r * 0.08], [0, item.yaw, 0], 1, 0.94);
    drawDecal(0.14, 0.86);
  } else if (item.theme === "communication") {
    renderer.draw("cube", [0.34, 0.28, 0.58], [item.x, y, item.z], [r * 0.88, r * 1.18, r * 0.86], [0, item.yaw, 0], 1, 0.72, { skinTile: 5, textureBlend: 0.58 });
    renderer.draw("cube", [0.16, 0.16, 0.2], [item.x, y - r * 0.44, item.z], [r * 1.05, r * 0.16, r * 0.95], [0, item.yaw, 0], 1, 0.3);
    if (variant >= 5) renderer.draw("sphere", [0.96, 0.84, 0.25], itemPosition(-0.24, y + r * 0.38, -0.48), [r * 0.09, r * 0.09, r * 0.09], [0, item.yaw, 0], 1, 0.9);
    drawDecal(0.18, 0.9);
  } else if (imageFamily === 0) {
    renderer.draw("cylinder", [0.82, 0.7, 0.46], [item.x, y - r * 0.24, item.z], [r * 0.32, r * 0.92, r * 0.32], [0, 0, 0], 1, 0.16, { skinTile: 1, textureBlend: 0.56, textureScale: [1, 1.7] });
    renderer.draw("sphere", [0.6, 0.94, 0.48], [item.x, y + r * 0.34, item.z], [r * 1.16, r * 1.02, r * 1.16], [0, item.yaw, 0], 1, 0.36, { skinTile: 6, textureBlend: 0.64, textureScale: 1.2 });
    renderer.draw("sphere", mixColor(color, [1, 0.96, 0.58], 0.28), itemPosition(-0.42, y + r * 0.61, -0.08), [r * 0.52, r * 0.55, r * 0.52], [0, item.yaw, 0], 1, 0.4, { skinTile: 6, textureBlend: 0.5 });
    if (!lowQuality) {
      renderer.draw("sphere", mixColor(color, [0.08, 0.42, 0.25], 0.22), itemPosition(0.42, y + r * 0.58, 0.12), [r * 0.56, r * 0.6, r * 0.56], [0, item.yaw, 0], 1, 0.34, { skinTile: 6, textureBlend: 0.56 });
    }
    if (variant >= 5) renderer.draw("sphere", [1, 0.84, 0.28], [item.x, y + r * 0.98, item.z], [r * 0.16, r * 0.16, r * 0.16], [0, 0, 0], 1, 0.9);
    drawDecal(0.24, 0.88);
  } else if (imageFamily === 1) {
    renderer.draw("cylinder", [0.34, 0.76, 0.42], [item.x, y - r * 0.26, item.z], [r * 0.18, r * 1.12, r * 0.18], [0, 0, 0], 1, 0.3, { skinTile: 6, textureBlend: 0.44, textureScale: [1, 1.8] });
    const petals = lowQuality ? 4 : 6;
    for (let petal = 0; petal < petals; petal += 1) {
      const angle = item.yaw + (petal / petals) * Math.PI * 2;
      renderer.draw("sphere", petal % 2 ? [1, 0.68, 0.46] : [0.98, 0.88, 0.46], [item.x + Math.cos(angle) * r * 0.48, y + r * 0.48, item.z + Math.sin(angle) * r * 0.48], [r * 0.46, r * 0.24, r * 0.46], [0, angle, 0], 1, 0.4, { skinTile: 6, textureBlend: 0.42 });
    }
    renderer.draw("sphere", [0.42, 0.74, 0.28], [item.x, y + r * 0.48, item.z], [r * 0.34, r * 0.34, r * 0.34], [0, 0, 0], 1, 0.45, { skinTile: 6, textureBlend: 0.34 });
    if (variant >= 5) renderer.draw("sphere", [0.98, 0.95, 0.44], [item.x, y + r * 0.48, item.z], [r * 0.12, r * 0.12, r * 0.12], [0, 0, 0], 1, 0.9);
    drawDecal(0.18, 0.82);
  } else if (imageFamily === 2) {
    renderer.draw("cylinder", [0.64, 0.78, 0.2], [item.x, y - r * 0.05, item.z], [r * 0.82, r * 0.88, r * 0.82], [0, item.yaw, 0], 1, 0.38, { skinTile: 6, textureBlend: 0.54 });
    renderer.draw("cone", [0.52, 0.34, 0.14], [item.x, y + r * 0.62, item.z], [r * 0.72, r * 0.42, r * 0.72], [0, item.yaw, 0], 1, 0.22);
    if (variant >= 5) renderer.draw("cube", [0.72, 0.42, 0.18], [item.x, y + r * 0.88, item.z], [r * 0.62, r * 0.16, r * 0.32], [0, item.yaw, 0.3], 1, 0.32);
    drawDecal(0.22, 0.84);
  } else if (imageFamily === 3) {
    renderer.draw("cylinder", [0.34, 0.78, 0.32], [item.x, y - r * 0.22, item.z], [r * 0.25, r * 0.98, r * 0.25], [0, 0, 0], 1, 0.42, { skinTile: 6, textureBlend: 0.44 });
    renderer.draw("cube", [0.12, 0.14, 0.16], [item.x, y + r * 0.38, item.z], [r * 0.7, r * 0.14, r * 0.52], [0, item.yaw, 0], 1, 0.48);
    renderer.draw("cylinder", [0.74, 0.9, 0.38], [item.x, y + r * 0.78, item.z], [r * 0.28, r * 0.56, r * 0.28], [0, 0, 0], 1, 0.72);
    if (variant >= 5) renderer.draw("sphere", [0.94, 0.98, 0.88], [item.x, y + r * 1.08, item.z], [r * 0.18, r * 0.18, r * 0.18], [0, 0, 0], 0.7, 0.95);
    drawDecal(0.16, 0.86);
  } else {
    renderer.draw("cone", [0.48, 0.82, 0.48], [item.x, y - r * 0.12, item.z], [r * 0.9, r * 1.42, r * 0.9], [0, item.yaw, 0], 1, 0.34, { skinTile: 6, textureBlend: 0.58, textureScale: [1, 1.6] });
    renderer.draw("sphere", [0.72, 0.95, 0.5], [item.x, y + r * 0.52, item.z], [r * 0.52, r * 0.64, r * 0.52], [0, item.yaw, 0], 1, 0.42, { skinTile: 6, textureBlend: 0.44 });
    renderer.draw("sphere", [1, 0.84, 0.3], [item.x, y + r * 0.94, item.z], [r * 0.18, r * 0.18, r * 0.18], [0, 0, 0], 1, 0.9);
    if (variant >= 5) renderer.draw("sphere", [0.24, 0.78, 0.48], itemPosition(-0.36, y + r * 0.3, 0), [r * 0.32, r * 0.16, r * 0.32], [0, item.yaw, 0], 1, 0.34);
    drawDecal(0.18, 0.84);
  }
}

function drawRobot(
  renderer: WebGlToyRenderer,
  state: GameState,
  time: number,
  heading: number,
) {
  const radius = state.radius;
  const base = ERAS[state.era].baseRadius;
  const robotScale = base * 0.43;
  const r = robotScale;
  const speed01 = clamp(Math.hypot(state.vx, state.vz) / Math.max(base * 7.2, 0.01), 0, 1);
  const forwardX = Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = Math.sin(heading);
  const portrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.12;
  const sideOffset = portrait ? 0.62 : 0.76;
  const centerX = state.x - forwardX * (radius + robotScale * 1.18) + rightX * robotScale * sideOffset;
  const centerZ = state.z - forwardZ * (radius + robotScale * 1.18) + rightZ * robotScale * sideOffset;
  const lean = speed01 * 0.1;
  const meshYaw = robotMeshYaw(heading);
  const stride = Math.sin(time * mix(5.2, 9.4, speed01)) * r * mix(0.05, 0.14, speed01);
  const local = (x: number, y: number, z: number): Vec3 => [
    centerX + rightX * x + forwardX * z,
    y,
    centerZ + rightZ * x + forwardZ * z,
  ];
  const ballContact = (x: number, y: number): Vec3 => [
    state.x - forwardX * radius * 0.92 + rightX * x,
    y,
    state.z - forwardZ * radius * 0.92 + rightZ * x,
  ];
  const drawLimb = (from: Vec3, to: Vec3, thickness: number, color: Vec3, gloss = 0.45) => {
    const transform = segmentTransform(from, to, thickness);
    renderer.draw(
      "cube",
      color,
      transform.position,
      transform.scale,
      transform.rotation,
      1,
      gloss,
      { skinTile: 3, textureBlend: 0.58, textureScale: [1, 1.8] },
    );
  };

  const bodyColor: Vec3 = [1, 0.77, 0.22];
  const shellColor: Vec3 = [0.09, 0.66, 0.78];
  const faceColor: Vec3 = [0.98, 0.95, 0.82];
  const jointColor: Vec3 = [0.055, 0.14, 0.18];
  const armColor: Vec3 = [0.98, 0.68, 0.2];
  drawContactShadow(renderer, centerX, centerZ, r * 1.1, 0.3, heading);
  renderer.draw("roundedBox", bodyColor, local(0, r * 0.82, 0), [r * 0.95, r * 1.12, r * 0.82], [lean, meshYaw, 0], 1, 0.64, { skinTile: 3, textureBlend: 0.74, textureScale: [1.2, 1.5] });
  renderer.draw("roundedBox", shellColor, local(0, r * 0.85, r * 0.49), [r * 0.72, r * 0.42, r * 0.18], [lean, meshYaw, 0], 1, 0.92, { skinTile: 5, textureBlend: 0.72 });
  renderer.draw("sphere", [1, 0.88, 0.26], local(-r * 0.16, r * 0.88, r * 0.56), [r * 0.055, r * 0.065, r * 0.045], [0, 0, 0], 1, 0.96);
  renderer.draw("sphere", [1, 0.88, 0.26], local(r * 0.16, r * 0.88, r * 0.56), [r * 0.055, r * 0.065, r * 0.045], [0, 0, 0], 1, 0.96);
  renderer.draw("roundedBox", [0.045, 0.28, 0.34], local(0, r * 0.78, -r * 0.52), [r * 0.56, r * 0.68, r * 0.24], [lean, meshYaw, 0], 1, 0.84, { skinTile: 5, textureBlend: 0.72, textureScale: [1, 1.4] });
  if (!state.lowQuality) {
    for (const ventY of [0.62, 0.82, 1.02]) {
      renderer.draw("roundedBox", [0.02, 0.09, 0.11], local(0, r * ventY, -r * 0.59), [r * 0.34, r * 0.045, r * 0.035], [0, meshYaw, 0], 1, 0.6, { skinTile: 5, textureBlend: 0.36 });
    }
  }
  for (const side of [-1, 1]) {
    renderer.draw("capsule", [0.92, 0.66, 0.2], local(side * r * 0.66, r * 0.78, 0), [r * 0.24, r * 0.84, r * 0.24], [lean, meshYaw, 0], 1, 0.58, { skinTile: 3, textureBlend: 0.56 });
    renderer.draw("sphere", jointColor, local(side * r * 0.62, r * 1.12, r * 0.1), [r * 0.24, r * 0.24, r * 0.24], [0, 0, 0], 1, 0.86);
    renderer.draw("sphere", jointColor, local(side * r * 0.36, r * 0.32, r * 0.04), [r * 0.16, r * 0.16, r * 0.16], [0, 0, 0], 1, 0.82);
  }
  renderer.draw("roundedBox", faceColor, local(0, r * 1.58, r * 0.05), [r * 0.86, r * 0.72, r * 0.78], [lean * 0.45, meshYaw, 0], 1, 0.84, { skinTile: 8, textureBlend: 0.52 });
  renderer.draw("roundedBox", shellColor, local(0, r * 1.54, r * 0.46), [r * 0.56, r * 0.23, r * 0.09], [0, meshYaw, 0], 1, 0.98, { skinTile: 7, textureBlend: 0.6 });
  renderer.draw("sphere", jointColor, local(-r * 0.2, r * 1.57, r * 0.52), [r * 0.085, r * 0.105, r * 0.075], [0, meshYaw, 0], 1, 0.94);
  renderer.draw("sphere", jointColor, local(r * 0.2, r * 1.57, r * 0.52), [r * 0.085, r * 0.105, r * 0.075], [0, meshYaw, 0], 1, 0.94);
  if (!state.lowQuality) {
    renderer.draw("capsule", shellColor, local(0, r * 1.98, -r * 0.14), [r * 0.13, r * 0.48, r * 0.13], [0, meshYaw, 0], 1, 0.78, { skinTile: 5, textureBlend: 0.62 });
    renderer.draw("sphere", [1, 0.78, 0.18], local(0, r * 2.22, -r * 0.14), [r * 0.17, r * 0.17, r * 0.17], [0, 0, 0], 1, 0.94);
  }

  const leftFoot = local(-r * 0.25, r * 0.23, -r * 0.1 + stride);
  const rightFoot = local(r * 0.25, r * 0.23, -r * 0.1 - stride);
  renderer.draw("capsule", [0.28, 0.7, 0.92], leftFoot, [r * 0.28, r * 0.62, r * 0.28], [0, meshYaw, 0.08], 1, 0.52, { skinTile: 4, textureBlend: 0.58 });
  renderer.draw("capsule", [0.28, 0.7, 0.92], rightFoot, [r * 0.28, r * 0.62, r * 0.28], [0, meshYaw, -0.08], 1, 0.52, { skinTile: 4, textureBlend: 0.58 });
  renderer.draw("roundedBox", [0.08, 0.42, 0.5], local(-r * 0.25, r * 0.05, r * 0.1 + stride), [r * 0.38, r * 0.14, r * 0.58], [0, meshYaw, 0], 1, 0.68, { skinTile: 5, textureBlend: 0.52 });
  renderer.draw("roundedBox", [0.08, 0.42, 0.5], local(r * 0.25, r * 0.05, r * 0.1 - stride), [r * 0.38, r * 0.14, r * 0.58], [0, meshYaw, 0], 1, 0.68, { skinTile: 5, textureBlend: 0.52 });

  const leftShoulder = local(-r * 0.78, r * 1.08, r * 0.2);
  const rightShoulder = local(r * 0.78, r * 1.08, r * 0.2);
  const leftHand = ballContact(-r * 0.72, radius * 1.05);
  const rightHand = ballContact(r * 0.72, radius * 1.05);
  drawLimb(leftShoulder, leftHand, r * 0.21, armColor);
  drawLimb(rightShoulder, rightHand, r * 0.21, armColor);
  const handleCenter = ballContact(0, radius * 1.03);
  renderer.draw(
    "roundedBox",
    [0.12, 0.66, 0.82],
    handleCenter,
    [r * 1.34, r * 0.16, r * 0.18],
    [0, meshYaw, 0],
    1,
    0.86,
    { skinTile: 5, textureBlend: 0.34 },
  );
  renderer.draw(
    "sphere",
    [1, 0.82, 0.24],
    handleCenter,
    [r * 0.22, r * 0.22, r * 0.16],
    [0, meshYaw, 0],
    1,
    0.94,
  );
  renderer.draw("sphere", [0.96, 0.42, 0.29], leftHand, [r * 0.22, r * 0.2, r * 0.22], [0, 0, 0], 1, 0.55);
  renderer.draw("sphere", [0.96, 0.42, 0.29], rightHand, [r * 0.22, r * 0.2, r * 0.22], [0, 0, 0], 1, 0.55);
}

function drawSpeedEffects(
  renderer: WebGlToyRenderer,
  state: GameState,
  camera: CameraState,
  time: number,
) {
  if (state.lowQuality || state.reducedMotion || camera.speed01 < 0.16) return;
  const r = state.radius;
  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);
  const streakCount = state.lowQuality ? 2 : 6;
  for (let index = 0; index < streakCount; index += 1) {
    const distance = r * (1.8 + index * 1.05);
    const side = Math.sin(time * 5 + index * 2.4) * r * (0.3 + index * 0.06);
    const fade = camera.speed01 * (1 - index / (streakCount + 1)) * 0.3;
    renderer.draw(
      "sphere",
      mixColor([1.0, 0.80, 0.24], ERAS[state.era].sky, index / 8),
      [
        state.x - forwardX * distance + rightX * side,
        r * mix(0.62, 0.18, index / 6),
        state.z - forwardZ * distance + rightZ * side,
      ],
      [r * mix(0.55, 0.16, index / streakCount), r * 0.14, r * mix(0.9, 0.25, index / streakCount)],
      [0, camera.heading, 0],
      fade,
      0.72,
    );
  }
}

function drawBall(renderer: WebGlToyRenderer, state: GameState, time: number) {
  const r = state.radius;
  const base = ERAS[state.era].baseRadius;
  const halo = Math.max(r, base * (state.lowQuality ? 0.32 : 0.38));
  drawContactShadow(renderer, state.x, state.z, r * 1.18, 0.36, state.rollZ * 0.2);
  renderer.draw(
    "sphere",
    [1, 0.78, 0.48],
    [state.x, r, state.z],
    [r * 2, r * 2, r * 2],
    [state.rollX, time * 0.15, state.rollZ],
    1,
    0.9,
    { skinTile: 0, textureBlend: 0.62, textureScale: 1.02 },
  );
  renderer.draw(
    "torus",
    [0.98, 0.72, 0.22],
    [state.x, r, state.z],
    [halo * 2.16, halo * 2.16, halo * 2.16],
    [Math.PI / 2 + state.rollX * 0.18, time * 0.22, state.rollZ * 0.18],
    1,
    0.9,
    { skinTile: 3, textureBlend: 0.56, textureScale: 1.2 },
  );
  if (!state.lowQuality) {
    renderer.draw(
      "torus",
      [0.16, 0.76, 0.86],
      [state.x, r, state.z],
      [halo * 1.68, halo * 1.68, halo * 1.68],
      [state.rollX * 0.16, Math.PI / 2 + time * 0.18, state.rollZ * 0.16],
      1,
      0.84,
      { skinTile: 5, textureBlend: 0.52, textureScale: 1.2 },
    );
  }
  renderer.draw(
    "sphere",
    [1.0, 0.94, 0.62],
    [state.x, r * 1.03, state.z],
    [r * 2.08, r * 2.08, r * 2.08],
    [state.rollX * 0.7, -time * 0.1, state.rollZ * 0.7],
    0.12,
    1,
  );
  const nodeCount = state.lowQuality ? 4 : 6;
  for (let node = 0; node < nodeCount; node += 1) {
    const angle = (node / nodeCount) * Math.PI * 2 + time * 0.34;
    const wave = Math.sin(angle * 2 + state.rollX) * halo * 0.14;
    renderer.draw(
      "sphere",
      node % 2 === 0 ? [1, 0.86, 0.3] : [0.24, 0.88, 0.94],
      [state.x + Math.cos(angle) * halo * 0.82, r + wave, state.z + Math.sin(angle) * halo * 0.82],
      [halo * 0.085, halo * 0.085, halo * 0.085],
      [0, 0, 0],
      1,
      0.72,
    );
  }
  renderer.draw(
    "sphere",
    [1.0, 0.98, 0.82],
    [state.x - r * 0.28, r * 1.28, state.z - r * 0.5],
    [r * 0.5, r * 0.37, r * 0.24],
    [state.rollX, 0, state.rollZ],
    0.88,
    1,
  );
  const visibleAttachments = state.attachments.slice(state.lowQuality ? -10 : -20);
  visibleAttachments.forEach((attachment, index) => {
    const random = seededRandom(attachment.seed);
    const theta = random() * Math.PI * 2 + state.rollZ;
    const phi = mix(0.35, Math.PI - 0.35, random());
    const distance = r * 1.05;
    const size = r * mix(0.13, 0.23, random());
    const x = state.x + Math.sin(phi) * Math.cos(theta) * distance;
    const y = r + Math.cos(phi) * distance;
    const z = state.z + Math.sin(phi) * Math.sin(theta) * distance;
    let displayShape: MeshName = attachment.shape;
    if (attachment.shape === "cube") {
      displayShape = "roundedBox";
    } else if (attachment.shape === "cylinder") {
      displayShape = "capsule";
    }
    renderer.draw(
      displayShape,
      THEME_BY_ID[attachment.theme].color,
      [x, y, z],
      [size, size, size],
      [theta, phi + time * 0.06 + index * 0.1, theta * 0.4],
      1,
      0.58,
      {
        skinTile: SKIN_BY_THEME[attachment.theme],
        textureBlend: 0.58,
        textureScale: 1.2,
      },
    );
  });
}

function visibleCollectibles(
  state: GameState,
  camera: CameraState,
  base: number,
): VisibleCollectible[] {
  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);
  const hardBudget = state.lowQuality ? 12 : 42;
  const candidates: VisibleCollectible[] = [];
  const required: VisibleCollectible[] = [];

  for (const item of state.items) {
    if (item.collected) continue;
    const dx = item.x - state.x;
    const dz = item.z - state.z;
    const distance = Math.hypot(dx, dz);
    const forwardDistance = dx * forwardX + dz * forwardZ;
    const sideDistance = Math.abs(dx * rightX + dz * rightZ);
    const near = distance < base * (state.lowQuality ? 3.4 : 8.5);
    const trailFocus =
      item.theme === ERAS[state.era].focus &&
      forwardDistance > -base * 1.8 &&
      forwardDistance < base * (state.lowQuality ? 7.5 : 30) &&
      sideDistance < base * (state.lowQuality ? 2.8 : 5.8);
    const readyTarget = canCollectByRule(state, item, state.bossReady) && distance < base * (state.lowQuality ? 4.2 : 12);
    const visibleForward =
      forwardDistance > -base * 5 &&
      forwardDistance < base * (state.lowQuality ? 24 : 58) &&
      sideDistance < base * (state.lowQuality ? 9 : 22);
    const priority =
      (item.special ? 2000 : 0) +
      (near ? 900 : 0) +
      (readyTarget ? 700 : 0) +
      (trailFocus ? 520 : 0) +
      (item.theme === ERAS[state.era].focus ? 180 : 0) -
      distance / Math.max(base, 0.001);
    const entry: VisibleCollectible = {
      item,
      lod: item.special || !state.lowQuality || distance < base * 2.3 ? "full" : "simple",
      drawShadow: item.special || distance < base * (state.lowQuality ? 3 : 8.5) || (trailFocus && distance < base * 13),
      priority,
      distance,
    };

    if (item.special || near || readyTarget || trailFocus) {
      required.push(entry);
    } else if (visibleForward) {
      candidates.push(entry);
    }
  }

  const selected = new Map<number, VisibleCollectible>();
  for (const entry of required.sort((a, b) => b.priority - a.priority)) {
    selected.set(entry.item.id, entry);
  }
  for (const entry of candidates.sort((a, b) => b.priority - a.priority)) {
    if (selected.size >= hardBudget) break;
    selected.set(entry.item.id, entry);
  }
  return [...selected.values()].sort((a, b) => b.distance - a.distance);
}

function drawWorld(
  renderer: WebGlToyRenderer,
  state: GameState,
  camera: CameraState,
  time: number,
) {
  const era = ERAS[state.era];
  const base = era.baseRadius;
  const half = era.arenaUnits * base;
  const visualTime = state.reducedMotion ? 0 : time;
  const shakeAmplitude = state.reducedMotion ? 0 : state.shake * base * 0.075;
  const renderCamera: CameraState = {
    ...camera,
    eye: [
      camera.eye[0] + Math.sin(time * 31) * shakeAmplitude,
      camera.eye[1] + Math.cos(time * 23) * shakeAmplitude * 0.45,
      camera.eye[2] + Math.sin(time * 19 + 1.1) * shakeAmplitude,
    ],
    target: [
      camera.target[0] + Math.sin(time * 17) * shakeAmplitude * 0.35,
      camera.target[1],
      camera.target[2] + Math.cos(time * 21) * shakeAmplitude * 0.35,
    ],
  };
  renderer.begin(
    mixColor(era.sky, [1, 0.96, 0.82], 0.04),
    renderCamera,
    base * 190,
    half * 0.72,
    half * 1.9,
  );
  drawEraEnvironment(renderer, state, camera, visualTime);

  const visibleItems = visibleCollectibles(state, camera, base);
  renderer.recordCulledItem(state.items.filter((item) => !item.collected).length - visibleItems.length);
  let shadowedItemIds: Set<number>;
  if (state.lowQuality) {
    const lowQualityShadowIds = visibleItems
      .filter((entry) => entry.item.special || entry.drawShadow)
      .sort((a, b) => {
        if (a.item.special === b.item.special) return a.distance - b.distance;
        return a.item.special ? -1 : 1;
      })
      .slice(0, 4)
      .map((entry) => entry.item.id);
    shadowedItemIds = new Set(lowQualityShadowIds);
  } else {
    shadowedItemIds = new Set(visibleItems.filter((entry) => entry.drawShadow).map((entry) => entry.item.id));
  }
  for (const entry of visibleItems) {
    renderer.recordRenderedItem();
    drawItem(
      renderer,
      entry.item,
      visualTime,
      state.lowQuality || entry.lod === "simple",
      era.focus,
      renderCamera,
      entry.lod,
      entry.drawShadow && shadowedItemIds.has(entry.item.id),
    );
  }
  for (const particle of state.particles) {
    const life = clamp(particle.life, 0, 1);
    const size = base * (0.055 + life * 0.075);
    renderer.draw(
      "sphere",
      particle.color,
      [particle.x, particle.y, particle.z],
      [size, size, size],
      [0, 0, 0],
      clamp(life * 1.45, 0, state.lowQuality ? 0.7 : 0.9),
      0.94,
    );
  }
  drawSpeedEffects(renderer, state, camera, visualTime);
  drawBall(renderer, state, visualTime);
  drawRobot(renderer, state, visualTime, camera.heading);
  renderer.flushTransparent();
}

function loadProgress() {
  if (typeof window === "undefined") {
    return defaultProgress({ maxEraIndex: ERAS.length - 1 });
  }
  try {
    return parseProgressJson(window.localStorage.getItem(SAVE_KEY), {
      maxEraIndex: ERAS.length - 1,
      defaultSoundEnabled: true,
    });
  } catch {
    return defaultProgress({ maxEraIndex: ERAS.length - 1 });
  }
}

export default function TimeRollGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameState | null>(null);
  const actionsRef = useRef<GameActions | null>(null);
  const keysRef = useRef(new Set<string>());
  const joystickRef = useRef({ x: 0, y: 0, active: false, pointerId: -1 });
  const boostPressedRef = useRef(false);
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [progressSnapshot, setProgressSnapshot] = useState<TimeRollProgressV2>(
    () => defaultProgress({ maxEraIndex: ERAS.length - 1 }),
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });
  const initialHud = useMemo<HudSnapshot>(
    () => ({
      mode: "intro",
      era: 0,
      timer: ERAS[0].seconds,
      radius: startingRadius(ERAS[0].baseRadius),
      boost: 1,
      themeTotals: { ...EMPTY_TOTALS },
      eraCollected: 0,
      totalCollected: 0,
      collectedLabel: "",
      message: ERAS[0].mission,
      nearbyName: "",
      nearbyCanCollect: false,
      bossReady: false,
      finalReady: false,
      growthTier: getGrowthTier(startingRadius(ERAS[0].baseRadius), ERAS[0].baseRadius).id,
      growthTierLabel: getGrowthTier(startingRadius(ERAS[0].baseRadius), ERAS[0].baseRadius).labelKo,
      growthRatio: getGrowthRatio(startingRadius(ERAS[0].baseRadius), ERAS[0].baseRadius),
      nextUnlockRatio: getNextTier(startingRadius(ERAS[0].baseRadius), ERAS[0].baseRadius)?.thresholdRatio ?? null,
      nextCollectSize: `${Math.round(GROWTH_TIERS[1].itemRadiusRangeRatio[0] * 100)}-${Math.round(GROWTH_TIERS[1].itemRadiusRangeRatio[1] * 100)}%`,
      bossName: "거대 물레방아",
      bossCollected: false,
      score: 0,
      combo: 0,
      maxCombo: 0,
      eraScore: 0,
      lastCollection: "",
      blockedCollision: "",
      bestEra: 0,
      bestSize: 0,
    }),
    [],
  );
  const [hud, setHud] = useState(initialHud);
  const [fatalError, setFatalError] = useState("");

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playTone = useCallback((frequency: number, duration = 0.09, rise = 0) => {
    if (!soundEnabledRef.current) return;
    try {
      let context = audioContextRef.current;
      if (!context) {
        context = new AudioContext();
        audioContextRef.current = context;
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      oscillator.frequency.linearRampToValueAtTime(frequency + rise, context.currentTime + duration);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration + 0.02);
    } catch {
      // Sound is a bonus. Gameplay never depends on audio availability.
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let renderer: WebGlToyRenderer;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowQuality =
      (window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 900) ||
      (navigator.hardwareConcurrency || 8) <= 4;
    try {
      renderer = new WebGlToyRenderer(canvas, lowQuality);
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D 화면을 시작하지 못했습니다.";
      queueMicrotask(() => {
        if (active) setFatalError(message);
      });
      return () => {
        active = false;
      };
    }

    const saved = loadProgress();
    let savedProgress = saved;
    const state = createState(0, reducedMotion, 20260730, lowQuality);
    const camera = createCameraState(state);
    gameRef.current = state;
    soundEnabledRef.current = saved.soundEnabled;
    queueMicrotask(() => {
      if (!active) return;
      setSoundEnabled(saved.soundEnabled);
      setProgressSnapshot(saved);
    });
    let bestEra = saved.bestEra;
    let bestSize = saved.bestSize;
    let running = true;
    let lastTime = performance.now();
    let uiAccumulator = 0;
    let manualUntil = 0;

    const persistProgress = () => {
      bestEra = Math.max(bestEra, state.era);
      bestSize = Math.max(bestSize, state.radius);
      savedProgress = {
        ...savedProgress,
        bestEra,
        bestSize,
        soundEnabled: soundEnabledRef.current,
      };
      try {
        window.localStorage.setItem(SAVE_KEY, serializeProgress(savedProgress));
        setProgressSnapshot(savedProgress);
      } catch {
        // Local progress is optional; gameplay remains available when storage is blocked.
      }
    };

    const saveEraResult = () => {
      savedProgress = recordEraResult(
        savedProgress,
        {
          era: state.era,
          score: state.eraScore,
          maxCombo: state.maxCombo,
          rank: rankFor(state.eraScore, state.maxCombo, true),
          completed: true,
          size: state.radius,
          storyEndingSeen: state.era === ERAS.length - 1,
        },
        { maxEraIndex: ERAS.length - 1 },
      );
      bestEra = savedProgress.bestEra;
      bestSize = savedProgress.bestSize;
      persistProgress();
    };

    const syncHud = (force = false) => {
      if (!force && uiAccumulator < 0.1) return;
      uiAccumulator = 0;
      setHud(makeHud(state, bestEra, bestSize));
    };

    const resetEra = (eraIndex: number, mode: GameMode = "playing") => {
      const era = ERAS[eraIndex];
      const eraStory = getTimeRollEraStory(era.focus);
      state.era = eraIndex;
      state.mode = mode;
      state.x = 0;
      state.z = 0;
      state.vx = 0;
      state.vz = 0;
      state.radius = startingRadius(era.baseRadius);
      state.rollX = 0;
      state.rollZ = 0;
      state.timer = era.seconds;
      state.boost = 1;
      state.items = generateItems(eraIndex, state.seed);
      state.attachments = [];
      state.particles = [];
      state.eraCollected = 0;
      state.collectedLabel = "";
      state.message = eraStory?.missionBriefing.join(" ") ?? era.mission;
      state.messageTime = 4.5;
      state.cameraKick = 0;
      state.bossReady = false;
      state.finalReady = false;
      state.eraScore = 0;
      state.combo = 0;
      state.comboTimer = 0;
      state.lastCollection = "";
      state.blockedCollision = "";
      updateGrowthState(state);
      resetCamera(camera, state);
      syncHud(true);
    };

    const collect = (item: Collectible) => {
      item.collected = true;
      state.totalCollected += 1;
      state.themeTotals[item.theme] += 1;
      if (item.theme === ERAS[state.era].focus && !item.special) {
        state.eraCollected += 1;
      }
      state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
      state.comboTimer = 2.4;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const gainedScore = scoreForItem(item, state);
      state.score += gainedScore;
      state.eraScore += gainedScore;
      state.radius = absorbRadius(state, item, collectionMultiplier(item, ERAS[state.era].focus));
      updateGrowthState(state);
      state.attachments.push({
        theme: item.theme,
        seed: item.id * 997 + state.era * 101,
        shape: item.shape,
        objectKind: item.objectKind,
        decalTile: item.decalTile,
      });
      state.collectedLabel = `${THEME_BY_ID[item.theme].label} · ${item.name}`;
      state.lastCollection = `${item.name} +${gainedScore}`;
      state.blockedCollision = "";
      state.message = `${item.name} 모았어요!`;
      state.messageTime = 1.6;
      state.shake = state.reducedMotion ? 0 : item.special ? 0.9 : 0.35;
      state.cameraKick = Math.max(state.cameraKick, item.special ? 1 : 0.42);
      if (!state.reducedMotion) {
        const random = seededRandom(item.id * 311 + state.totalCollected * 47);
        const particleCount = state.lowQuality ? 3 : 10;
        for (let index = 0; index < particleCount; index += 1) {
          state.particles.push({
            x: item.x,
            y: state.radius * 0.9,
            z: item.z,
            vx: (random() - 0.5) * state.radius * 3,
            vy: random() * state.radius * 3 + state.radius,
            vz: (random() - 0.5) * state.radius * 3,
            life: 0.65,
            color: THEME_BY_ID[item.theme].color,
          });
        }
      }
      playTone(430 + state.era * 45, item.special ? 0.3 : 0.11, item.special ? 420 : 130);

      const era = ERAS[state.era];
      if (state.eraCollected >= era.goal && !state.bossReady) {
        const eraStory = getTimeRollEraStory(era.focus);
        state.bossReady = true;
        state.finalReady = true;
        state.message = `${eraStory?.bossLabel ?? "거대 목표"} 해금! 충분히 커져서 코어를 모아요.`;
        state.messageTime = 5;
      }
      if (item.special) {
        const eraStory = getTimeRollEraStory(era.focus);
        if (state.era === ERAS.length - 1) {
          state.mode = "victory";
          state.message = TIME_ROLL_ENDING.title;
          state.messageTime = 20;
          bestEra = ERAS.length - 1;
          saveEraResult();
          playTone(660, 0.5, 520);
        } else {
          state.mode = "eraClear";
          state.message = eraStory?.clearTitle ?? `${era.name} 완성!`;
          state.messageTime = 10;
          saveEraResult();
          playTone(620, 0.36, 380);
        }
      }
      syncHud(true);
    };

    const update = (dt: number) => {
      const safeDt = clamp(dt, 0, 1 / 20);
      state.messageTime = Math.max(0, state.messageTime - safeDt);
      state.bumpCooldown = Math.max(0, state.bumpCooldown - safeDt);
      state.comboTimer = Math.max(0, state.comboTimer - safeDt);
      if (state.comboTimer === 0) state.combo = 0;
      state.shake = Math.max(0, state.shake - safeDt * 2.5);
      state.cameraKick = Math.max(0, state.cameraKick - safeDt * 2.2);
      for (const particle of state.particles) {
        particle.life -= safeDt;
        particle.vy -= state.radius * 4.5 * safeDt;
        particle.x += particle.vx * safeDt;
        particle.y += particle.vy * safeDt;
        particle.z += particle.vz * safeDt;
      }
      state.particles = state.particles.filter((particle) => particle.life > 0);
      if (state.mode !== "playing") {
        updateCamera(camera, state, safeDt);
        uiAccumulator += safeDt;
        syncHud();
        return;
      }

      const keys = keysRef.current;
      const joystick = joystickRef.current;
      let inputX = 0;
      let inputZ = 0;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) inputX -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) inputX += 1;
      if (keys.has("ArrowUp") || keys.has("KeyW")) inputZ -= 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) inputZ += 1;
      if (joystick.active) {
        inputX += joystick.x;
        inputZ += joystick.y;
      }
      const magnitude = Math.hypot(inputX, inputZ);
      if (magnitude > 1) {
        inputX /= magnitude;
        inputZ /= magnitude;
      }
      const screenRight = inputX;
      const screenForward = -inputZ;
      const cameraCos = Math.cos(camera.heading);
      const cameraSin = Math.sin(camera.heading);
      inputX = screenRight * cameraCos + screenForward * cameraSin;
      inputZ = screenRight * cameraSin - screenForward * cameraCos;

      const boosting =
        (keys.has("ShiftLeft") || keys.has("ShiftRight") || boostPressedRef.current) &&
        state.boost > 0.03 &&
        magnitude > 0.05;
      if (boosting) {
        state.boost = Math.max(0, state.boost - safeDt * 0.27);
      } else {
        state.boost = Math.min(1, state.boost + safeDt * 0.16);
      }
      const braking = keys.has("Space");
      const base = ERAS[state.era].baseRadius;
      const movementScale = base * mix(1.75, 4.9, clamp(state.growthRatio, 0.18, 1.15));
      const topSpeed = movementScale * (boosting ? 1.55 : 1);
      const response = braking ? 0.18 : 1 - Math.pow(0.0015, safeDt);
      const targetVx = braking ? 0 : inputX * topSpeed;
      const targetVz = braking ? 0 : inputZ * topSpeed;
      state.vx = mix(state.vx, targetVx, response);
      state.vz = mix(state.vz, targetVz, response);
      if (magnitude < 0.03 && !braking) {
        state.vx *= Math.pow(0.12, safeDt);
        state.vz *= Math.pow(0.12, safeDt);
      }

      const previousX = state.x;
      const previousZ = state.z;
      state.x += state.vx * safeDt;
      state.z += state.vz * safeDt;
      const half = ERAS[state.era].arenaUnits * ERAS[state.era].baseRadius;
      state.x = clamp(state.x, -half, half);
      state.z = clamp(state.z, -half, half);
      if (state.x === -half || state.x === half) state.vx *= -0.22;
      if (state.z === -half || state.z === half) state.vz *= -0.22;
      state.rollX += (state.z - previousZ) / Math.max(state.radius, 0.01);
      state.rollZ -= (state.x - previousX) / Math.max(state.radius, 0.01);

      for (const item of state.items) {
        if (item.collected) continue;
        const dx = item.x - state.x;
        const dz = item.z - state.z;
        const distance = Math.hypot(dx, dz);
        const collisionDistance = state.radius + item.r * 0.58;
        if (distance >= collisionDistance) continue;
        if (canCollectByRule(state, item, state.bossReady)) {
          collect(item);
          if (state.mode !== "playing") break;
        } else {
          const velocityLength = Math.hypot(state.vx, state.vz);
          const normalX =
            distance > 0.001
              ? dx / distance
              : velocityLength > 0.001
                ? state.vx / velocityLength
                : Math.sin(camera.heading);
          const normalZ =
            distance > 0.001
              ? dz / distance
              : velocityLength > 0.001
                ? state.vz / velocityLength
                : -Math.cos(camera.heading);
          const overlap = collisionDistance - distance;
          state.x -= normalX * (overlap + state.radius * 0.04);
          state.z -= normalZ * (overlap + state.radius * 0.04);
          state.vx *= -0.16;
          state.vz *= -0.16;
          if (state.bumpCooldown <= 0) {
            const neededRadius = requiredPlayerRadius(item);
            state.blockedCollision = item.name;
            state.message = item.special && !state.bossReady
              ? `${Math.max(0, ERAS[state.era].goal - state.eraCollected)}개 더 모으면 거대 목표를 열 수 있어요`
              : `${item.name}은 아직 커요. ${formatSize(neededRadius, state.era)}까지 키워요!`;
            state.messageTime = 2.2;
            state.bumpCooldown = 0.75;
            state.shake = state.reducedMotion ? 0 : 0.25;
            playTone(190, 0.08, -50);
          }
        }
      }

      state.timer = Math.max(0, state.timer - safeDt);
      if (state.timer <= 0) {
        state.mode = "timeUp";
        state.message = "조금만 더 굴려볼까요?";
        state.messageTime = 20;
        persistProgress();
        playTone(280, 0.22, -100);
      }
      updateCamera(camera, state, safeDt);
      uiAccumulator += safeDt;
      syncHud();
    };

    const getTextState = () => {
      const nearby = state.items
        .filter((item) => !item.collected)
        .map((item) => ({
          id: item.id,
          name: item.name,
          theme: THEME_BY_ID[item.theme].label,
          x: Number(item.x.toFixed(2)),
          z: Number(item.z.toFixed(2)),
          size: Number(item.r.toFixed(2)),
          requiredRadius: Number(requiredPlayerRadius(item).toFixed(2)),
          objectKind: item.objectKind,
          decalTile: item.decalTile,
          distance: Number(Math.hypot(item.x - state.x, item.z - state.z).toFixed(2)),
          collectible: canCollectByRule(state, item, state.bossReady),
          special: !!item.special,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);
      const boss = state.items.find((item) => item.special);
      const renderStats = renderer.getRenderStats();
      return JSON.stringify({
        coordinateSystem: "ground plane x/z; x increases right, z decreases forward; y is up",
        mode: state.mode,
        era: {
          index: state.era + 1,
          total: ERAS.length,
          name: ERAS[state.era].name,
          focus: THEME_BY_ID[ERAS[state.era].focus].label,
        },
        player: {
          x: Number(state.x.toFixed(2)),
          z: Number(state.z.toFixed(2)),
          radius: Number(state.radius.toFixed(2)),
          sizeLabel: formatSize(state.radius, state.era),
          growthRatio: Number(state.growthRatio.toFixed(3)),
          growthTier: state.growthTier,
          nextUnlockRatio: state.nextUnlockRatio,
          velocity: { x: Number(state.vx.toFixed(2)), z: Number(state.vz.toFixed(2)) },
        },
        score: state.score,
        combo: state.combo,
        maxCombo: state.maxCombo,
        eraScore: state.eraScore,
        timerSeconds: Number(state.timer.toFixed(1)),
        boost: Number(state.boost.toFixed(2)),
        reducedMotion: state.reducedMotion,
        quality: state.lowQuality ? "mobile" : "high",
        objectField: {
          total: state.items.length,
          visible: state.items.filter((item) => !item.collected).length,
          themeVisibleTotals: THEMES.reduce(
            (totals, theme) => ({
              ...totals,
              [theme.id]: state.items.filter((item) => !item.collected && item.theme === theme.id).length,
            }),
            {} as Record<ThemeId, number>,
          ),
          variantKindsVisible: Array.from(new Set(state.items.filter((item) => !item.collected).map((item) => `${item.theme}:${item.objectKind}`))).sort(),
        },
        camera: {
          heading: Number(camera.heading.toFixed(3)),
          bank: Number(camera.bank.toFixed(3)),
          fovDegrees: Number((camera.fov * 180 / Math.PI).toFixed(1)),
          speed01: Number(camera.speed01.toFixed(2)),
          eye: camera.eye.map((value) => Number(value.toFixed(2))),
          target: camera.target.map((value) => Number(value.toFixed(2))),
        },
        playerFraming: playerFramingSnapshot(state, camera, canvas),
        renderStats: {
          drawCalls: renderStats.drawCalls,
          triangles: Math.round(renderStats.triangles),
          transparentCalls: renderStats.transparentCalls,
          culledItems: renderStats.culledItems,
          renderedItems: renderStats.renderedItems,
          frameMsP95: Number(renderStats.frameMsP95.toFixed(2)),
        },
        goal: {
          collected: state.eraCollected,
          required: ERAS[state.era].goal,
          bossReady: state.bossReady,
          bossTarget: boss
            ? {
                id: boss.id,
                name: boss.name,
                collected: boss.collected,
                requiredRadius: Number(requiredPlayerRadius(boss).toFixed(2)),
                collectible: canCollectByRule(state, boss, state.bossReady),
              }
            : null,
          finalReady: state.finalReady,
        },
        blockedCollision: state.blockedCollision,
        lastCollection: state.lastCollection,
        totals: state.themeTotals,
        nearby,
      });
    };

    actionsRef.current = {
      start: (eraIndex = 0) => {
        const safeEra = clamp(Math.floor(eraIndex), 0, bestEra);
        resetEra(safeEra, "playing");
        playTone(420, 0.14, 180);
      },
      togglePause: () => {
        if (state.mode === "playing") {
          state.mode = "paused";
          state.message = "잠깐 쉬는 중";
          state.messageTime = 20;
        } else if (state.mode === "paused") {
          state.mode = "playing";
          state.message = "다시 출발!";
          state.messageTime = 1.5;
        }
        syncHud(true);
      },
      nextEra: () => {
        if (state.mode !== "eraClear") return;
        const next = Math.min(state.era + 1, ERAS.length - 1);
        bestEra = Math.max(bestEra, next);
        resetEra(next, "playing");
        persistProgress();
        playTone(520, 0.22, 280);
      },
      retryEra: () => {
        resetEra(state.era, "playing");
        playTone(380, 0.11, 100);
      },
      restart: () => {
        state.themeTotals = { ...EMPTY_TOTALS };
        state.totalCollected = 0;
        state.score = 0;
        state.maxCombo = 0;
        state.combo = 0;
        state.comboTimer = 0;
        resetEra(0, "playing");
        playTone(420, 0.14, 180);
      },
      setBoost: (active: boolean) => {
        boostPressedRef.current = active;
      },
    };

    const completeEraForTest = () => {
      const era = ERAS[state.era];
      state.mode = "playing";
      state.eraCollected = era.goal;
      state.bossReady = true;
      state.finalReady = true;
      state.radius = Math.max(state.radius, requiredPlayerRadius({ r: era.baseRadius * BOSS_RADIUS_RATIO }) * 1.03);
      updateGrowthState(state);
      const boss = state.items.find((item) => item.special && !item.collected);
      if (boss) {
        state.x = boss.x;
        state.z = boss.z;
        collect(boss);
      }
      syncHud(true);
    };

    const collectItemForTest = (id: number) => {
      const item = state.items.find((entry) => entry.id === id);
      if (!item || item.collected) return false;
      if (!canCollectByRule(state, item, state.bossReady)) return false;
      collect(item);
      syncHud(true);
      return true;
    };

    const warpToItemForTest = (id: number) => {
      const item = state.items.find((entry) => entry.id === id && !entry.collected);
      if (!item) return false;
      state.x = item.x;
      state.z = item.z;
      state.vx = 0;
      state.vz = 0;
      updateCamera(camera, state, 1 / 60);
      syncHud(true);
      return true;
    };

    window.render_game_to_text = getTextState;
    window.advanceTime = (ms: number) => {
      manualUntil = performance.now() + 1200;
      const step = 1 / 60;
      const count = Math.max(1, Math.ceil(ms / (1000 / 60)));
      for (let index = 0; index < count; index += 1) update(step);
      drawWorld(renderer, state, camera, performance.now() / 1000);
      syncHud(true);
    };
    const exposeTestControls =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (exposeTestControls) {
      window.__timeRollTest = {
        start: () => actionsRef.current?.start(0),
        startEra: (index: number) => {
          bestEra = Math.max(bestEra, clamp(Math.floor(index), 0, ERAS.length - 1));
          resetEra(clamp(Math.floor(index), 0, ERAS.length - 1), "playing");
        },
        setRadiusRatio: (ratio: number) => {
          const era = ERAS[state.era];
          state.radius = Math.max(startingRadius(era.baseRadius), era.baseRadius * Math.max(0, Number(ratio) || 0));
          updateGrowthState(state);
          syncHud(true);
        },
        collectItem: collectItemForTest,
        warpToItem: warpToItemForTest,
        unlockBoss: () => {
          state.eraCollected = ERAS[state.era].goal;
          state.bossReady = true;
          updateGrowthState(state);
          syncHud(true);
        },
        completeEra: completeEraForTest,
        nextEra: () => actionsRef.current?.nextEra(),
        retry: () => actionsRef.current?.retryEra(),
        setCameraHeading: (headingRadians: number) => {
          camera.heading = wrapAngle(Number(headingRadians) || 0);
          camera.bank = 0;
          camera.speed01 = 0;
          camera.previousVx = 0;
          camera.previousVz = 0;
          state.vx = 0;
          state.vz = 0;
          updateCamera(camera, state, 1);
          drawWorld(renderer, state, camera, performance.now() / 1000);
          syncHud(true);
        },
        setCameraPose: (eye: Vec3, target: Vec3, fovDegrees = 52.2) => {
          camera.eye = eye.map((value) => Number(value) || 0) as Vec3;
          camera.target = target.map((value) => Number(value) || 0) as Vec3;
          camera.up = [0, 1, 0];
          camera.heading = 0;
          camera.bank = 0;
          camera.speed01 = 0;
          camera.previousVx = 0;
          camera.previousVz = 0;
          camera.fov = clamp(Number(fovDegrees) || 52.2, 38, 72) * Math.PI / 180;
          state.vx = 0;
          state.vz = 0;
          drawWorld(renderer, state, camera, performance.now() / 1000);
          syncHud(true);
        },
        setPlayerPosition: (x: number, z: number) => {
          state.x = Number.isFinite(Number(x)) ? Number(x) : state.x;
          state.z = Number.isFinite(Number(z)) ? Number(z) : state.z;
          state.vx = 0;
          state.vz = 0;
          camera.bank = 0;
          camera.speed01 = 0;
          updateCamera(camera, state, 1);
          drawWorld(renderer, state, camera, performance.now() / 1000);
          syncHud(true);
        },
        getState: getTextState,
      };
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const controlled = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "Space",
        "ShiftLeft",
        "ShiftRight",
      ];
      if (controlled.includes(event.code)) event.preventDefault();
      if (event.code === "KeyF" && !event.repeat) {
        event.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => undefined);
        } else {
          document.exitFullscreen?.().catch(() => undefined);
        }
        return;
      }
      if (event.code === "KeyR" && !event.repeat) {
        actionsRef.current?.retryEra();
        return;
      }
      if (event.code === "Escape" && !document.fullscreenElement && !event.repeat) {
        actionsRef.current?.togglePause();
        return;
      }
      if ((event.code === "Enter" || event.code === "Space") && state.mode === "intro") {
        actionsRef.current?.start(0);
      }
      keysRef.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code);
    };
    const onBlur = () => {
      keysRef.current.clear();
      boostPressedRef.current = false;
    };
    const onFullscreenChange = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    const frame = (time: number) => {
      if (!running) return;
      const elapsed = clamp((time - lastTime) / 1000, 0, 0.05);
      lastTime = time;
      if (time > manualUntil) update(elapsed);
      drawWorld(renderer, state, camera, time / 1000);
      requestAnimationFrame(frame);
    };
    syncHud(true);
    requestAnimationFrame(frame);

    return () => {
      active = false;
      running = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      delete window.render_game_to_text;
      delete window.advanceTime;
      delete window.__timeRollTest;
      actionsRef.current = null;
      gameRef.current = null;
      renderer.dispose();
    };
  }, [playTone]);

  const era = ERAS[hud.era];
  const eraStory = TIME_ROLL_ERA_STORIES[hud.era];
  const progress = clamp(hud.eraCollected / era.goal, 0, 1);
  const cappedEraCollected = Math.min(hud.eraCollected, era.goal);
  const timerProgress = clamp(hud.timer / era.seconds, 0, 1);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((enabled) => {
      const next = !enabled;
      soundEnabledRef.current = next;
      try {
        const current = loadProgress();
        const updated = { ...current, soundEnabled: next };
        window.localStorage.setItem(SAVE_KEY, serializeProgress(updated));
        setProgressSnapshot(updated);
      } catch {
        // Sound remains usable even when local storage is unavailable.
      }
      return next;
    });
  }, []);

  const updateJoystickFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - (box.left + box.width / 2)) / (box.width * 0.36), -1, 1);
    const y = clamp((event.clientY - (box.top + box.height / 2)) / (box.height * 0.36), -1, 1);
    const magnitude = Math.hypot(x, y);
    const normalizedX = magnitude > 1 ? x / magnitude : x;
    const normalizedY = magnitude > 1 ? y / magnitude : y;
    joystickRef.current.x = normalizedX;
    joystickRef.current.y = normalizedY;
    setJoystickKnob({ x: normalizedX * 34, y: normalizedY * 34 });
  }, []);

  const onJoystickDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      joystickRef.current.active = true;
      joystickRef.current.pointerId = event.pointerId;
      updateJoystickFromPointer(event);
    },
    [updateJoystickFromPointer],
  );

  const onJoystickMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!joystickRef.current.active || joystickRef.current.pointerId !== event.pointerId) return;
      updateJoystickFromPointer(event);
    },
    [updateJoystickFromPointer],
  );

  const releaseJoystick = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (joystickRef.current.pointerId !== event.pointerId) return;
    joystickRef.current = { x: 0, y: 0, active: false, pointerId: -1 };
    setJoystickKnob({ x: 0, y: 0 });
  }, []);

  return (
    <main className="game-shell" data-era={hud.era}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="시간 구슬을 굴려 시대별 물건을 모으는 3D 게임 화면"
      />

      {fatalError ? (
        <section className="game-overlay fatal-overlay" role="alert">
          <div className="result-panel">
            <p className="eyebrow">3D 화면 안내</p>
            <h1>게임 화면을 열 수 없어요</h1>
            <p>{fatalError}</p>
            <p className="gentle-copy">최신 Chrome, Safari 또는 Edge에서 다시 열어 주세요.</p>
          </div>
        </section>
      ) : null}

      <section className="hud" aria-label="게임 정보">
        <div className="hud-top">
          <div className="era-card">
            <span className="era-number">시대 {hud.era + 1} / {ERAS.length}</span>
            <strong>{era.name}</strong>
            <span>{era.year}</span>
          </div>

          <div className="mission-progress" aria-label={`${era.mission} ${cappedEraCollected}/${era.goal}`}>
            <div className="mission-row">
              <span>{THEME_BY_ID[era.focus].icon} {THEME_BY_ID[era.focus].label} 미션</span>
              <strong>{cappedEraCollected} / {era.goal}</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${progress * 100}%`, backgroundColor: `rgb(${THEME_BY_ID[era.focus].color.map((v) => Math.round(v * 255)).join(",")})` }} />
            </div>
          </div>

          <div className="size-card">
            <span>시간 구슬 크기</span>
            <strong>{formatSize(hud.radius, hud.era)}</strong>
          </div>
        </div>

        <div className="timer-bar" aria-label={`남은 시간 ${Math.ceil(hud.timer)}초`}>
          <span style={{ width: `${timerProgress * 100}%` }} />
          <b>{Math.ceil(hud.timer)}초</b>
        </div>

        <div className="growth-panel" aria-label={`성장 단계 ${hud.growthTierLabel}`}>
          <div className="growth-row">
            <span>성장 단계</span>
            <strong>{hud.growthTierLabel}</strong>
            <em>{Math.round(hud.growthRatio * 100)}%</em>
          </div>
          <div className="growth-track">
            <span style={{ width: `${clamp(hud.growthRatio / BOSS_RADIUS_RATIO, 0, 1) * 100}%` }} />
          </div>
          <div className="growth-meta">
            <span>다음 수집 크기 {hud.nextCollectSize}</span>
            <b>{hud.bossReady ? `${hud.bossName} 수집 가능` : `${Math.max(0, era.goal - hud.eraCollected)}개 후 거대 목표`}</b>
          </div>
        </div>

        <div className="score-strip" aria-label={`점수 ${hud.score}점 콤보 ${hud.combo}`}>
          <span>점수 <strong>{hud.score.toLocaleString("ko-KR")}</strong></span>
          <span>콤보 <strong>{hud.combo}</strong></span>
          <span>시대 점수 <strong>{hud.eraScore.toLocaleString("ko-KR")}</strong></span>
        </div>

        <div className="theme-strip" aria-label="주제별 수집 수">
          {THEMES.map((theme) => (
            <div
              className={`theme-chip ${theme.id === era.focus ? "is-focus" : ""}`}
              key={theme.id}
            >
              <span style={{ backgroundColor: `rgb(${theme.color.map((v) => Math.round(v * 255)).join(",")})` }}>{theme.icon}</span>
              <b>{theme.label}</b>
              <em>{hud.themeTotals[theme.id]}</em>
            </div>
          ))}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={soundEnabled ? "소리 끄기" : "소리 켜기"}
            onClick={toggleSound}
          >
            {soundEnabled ? "♪" : "×♪"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={fullscreen ? "전체화면 닫기" : "전체화면 열기"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? "↙" : "↗"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={hud.mode === "paused" ? "게임 계속하기" : "게임 잠시 멈추기"}
            onClick={() => actionsRef.current?.togglePause()}
            disabled={hud.mode !== "playing" && hud.mode !== "paused"}
          >
            {hud.mode === "paused" ? "▶" : "Ⅱ"}
          </button>
        </div>

        {hud.message ? (
          <div className="game-message" role="status" aria-live="polite">
            {hud.message}
          </div>
        ) : null}

        {hud.nearbyName && hud.mode === "playing" ? (
          <div className={`nearby-label ${hud.nearbyCanCollect ? "can-collect" : ""}`}>
            <span>{hud.nearbyCanCollect ? "지금 모을 수 있어요" : "조금 더 커져야 해요"}</span>
            <strong>{hud.nearbyName}</strong>
          </div>
        ) : null}

        <div className="boost-meter" aria-label={`부스터 ${Math.round(hud.boost * 100)}퍼센트`}>
          <span>반짝 부스터</span>
          <div><i style={{ width: `${hud.boost * 100}%` }} /></div>
        </div>
      </section>

      <div className="desktop-help" aria-hidden="true">
        <span><kbd>WASD</kbd> / 방향키 이동</span>
        <span><kbd>Shift</kbd> 부스터</span>
        <span><kbd>Space</kbd> 멈춤</span>
        <span><kbd>F</kbd> 전체화면</span>
      </div>

      <div className="touch-controls" aria-label="터치 조작">
        <div
          className="joystick"
          role="application"
          aria-label="이동 조이스틱"
          onPointerDown={onJoystickDown}
          onPointerMove={onJoystickMove}
          onPointerUp={releaseJoystick}
          onPointerCancel={releaseJoystick}
        >
          <span
            className="joystick-knob"
            style={{ transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)` }}
          />
        </div>
        <button
          type="button"
          className="boost-button"
          aria-label="누르고 있는 동안 반짝 부스터"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            actionsRef.current?.setBoost(true);
          }}
          onPointerUp={() => actionsRef.current?.setBoost(false)}
          onPointerCancel={() => actionsRef.current?.setBoost(false)}
        >
          <span>✦</span>
          부스터
        </button>
      </div>

      {hud.mode === "intro" ? (
        <section className="game-overlay intro-overlay" aria-labelledby="game-title">
          {/* vinext serves this static key art directly; its Next image optimizer is not available in the worker runtime. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="intro-keyart"
            src="/time-roll-key-art.jpg"
            alt=""
          />
          <div className="title-stage">
            <p className="title-kicker">{TIME_ROLL_INTRO_TEASER.kicker}</p>
            <h1 id="game-title" className="title-logo">
              {TIME_ROLL_INTRO_TEASER.title.map((line) => <span key={line}>{line}</span>)}
            </h1>
            <p className="title-tagline">
              {TIME_ROLL_INTRO_TEASER.tagline} 미래 도시의 시간동력핵을 되살리기 위해
              {" "}{TIME_ROLL_PROTAGONIST.name}가 다섯 시대의 기술 코어를 모아요.
            </p>
            <div className="scale-promise" aria-label="성장 크기 흐름">
              {["손안 물건", "책상 위 물건", "교실 물건", "건물만 한 물건", "시대 상징물"].map((label, index) => (
                <Fragment key={label}>
                  <span className="scale-step">{label}</span>
                  {index < 4 ? <i className="scale-arrow" aria-hidden="true">→</i> : null}
                </Fragment>
              ))}
            </div>
            <div className="launch-actions">
              <button
                id="start-btn"
                type="button"
                className="primary-button launch-button"
                onClick={() => actionsRef.current?.start(hud.bestEra > 0 ? hud.bestEra : 0)}
              >
                <span>{hud.bestEra > 0 ? "이어서 굴리기" : "처음 시작"}</span>
                <b>→</b>
              </button>
              {hud.bestEra > 0 ? (
                <button type="button" className="resume-button" onClick={() => actionsRef.current?.start(0)}>
                  처음부터
                </button>
              ) : null}
            </div>
            <p className="title-tip">{TIME_ROLL_INTRO_TEASER.tip}</p>
          </div>
          <div className="era-rail" aria-label="시대 선택">
            {ERAS.map((entry, index) => {
              const record = progressSnapshot.eras[String(index)];
              return (
                <button
                  type="button"
                  className={`era-node ${index === hud.era ? "is-current" : ""} ${index <= hud.bestEra ? "is-unlocked" : "is-locked"}`}
                  key={entry.shortName}
                  onClick={() => actionsRef.current?.start(index)}
                  disabled={index > hud.bestEra}
                  aria-current={index === hud.era ? "step" : undefined}
                >
                  <span className="era-dot">{index + 1}</span>
                  <span className="era-copy">
                    <b>{entry.shortName}</b>
                    <small>
                      {THEME_BY_ID[entry.focus].label}
                      {record?.completed ? ` · ${record.bestRank}랭크` : ""}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="intro-utility" aria-hidden="true">
            {formatSize(startingRadius(ERAS[0].baseRadius), 0)} 시작 · 누적 최고 {progressSnapshot.totalScore.toLocaleString("ko-KR")}점
          </div>
        </section>
      ) : null}

      {hud.mode === "paused" ? (
        <section className="game-overlay compact-overlay" aria-labelledby="pause-title">
          <div className="result-panel">
            <p className="eyebrow">잠깐 쉬는 중</p>
            <h2 id="pause-title">시간도 잠시 멈췄어요</h2>
            <p>준비되면 같은 자리에서 다시 시작할 수 있어요.</p>
            <button type="button" className="primary-button" onClick={() => actionsRef.current?.togglePause()}>
              <span>계속 굴리기</span><b>▶</b>
            </button>
            <button type="button" className="text-button" onClick={() => actionsRef.current?.restart()}>
              처음부터 다시
            </button>
          </div>
        </section>
      ) : null}

      {hud.mode === "eraClear" ? (
        <section className="game-overlay compact-overlay" aria-labelledby="clear-title">
          <div className="result-panel success-panel">
            <div className="result-badge">{THEME_BY_ID[era.focus].icon}</div>
            <p className="eyebrow">{eraStory.clearTitle}</p>
            <h2 id="clear-title">{eraStory.eraName}</h2>
            <p>
              {eraStory.clearLines.join(" ")} 거대 코어 <strong>{hud.bossName}</strong> 수집 완료.
              시대 점수 {hud.eraScore.toLocaleString("ko-KR")}점 · 최고 콤보 {hud.maxCombo} · 랭크 {rankFor(hud.eraScore, hud.maxCombo, hud.bossCollected)}
            </p>
            <button type="button" className="primary-button" onClick={() => actionsRef.current?.nextEra()}>
              <span>다음 시대로</span><b>→</b>
            </button>
          </div>
        </section>
      ) : null}

      {hud.mode === "timeUp" ? (
        <section className="game-overlay compact-overlay" aria-labelledby="timeup-title">
          <div className="result-panel">
            <p className="eyebrow">이번 기록 {hud.eraCollected} / {era.goal}</p>
            <h2 id="timeup-title">조금만 더 굴려볼까요?</h2>
            <p>모은 방법은 이미 알았어요. 같은 시대를 바로 다시 도전할 수 있어요.</p>
            <button type="button" className="primary-button" onClick={() => actionsRef.current?.retryEra()}>
              <span>이 시대 다시 도전</span><b>↻</b>
            </button>
            <button type="button" className="text-button" onClick={() => actionsRef.current?.restart()}>
              처음 시대부터
            </button>
          </div>
        </section>
      ) : null}

      {hud.mode === "victory" ? (
        <section className="game-overlay victory-overlay" aria-labelledby="victory-title">
          <div className="result-panel victory-panel">
            <div className="victory-sparkles" aria-hidden="true">✦ · ✧ · ✦</div>
            <p className="eyebrow">{TIME_ROLL_ENDING.eyebrow}</p>
            <h2 id="victory-title">{TIME_ROLL_ENDING.title}</h2>
            <p>
              {TIME_ROLL_ENDING.lines.join(" ")}
              {" "}{TIME_ROLL_PROTAGONIST.name}와 시간 구슬의 가장 큰 기록은
              {" "}<strong>{formatSize(hud.radius, hud.era)}</strong>예요.
            </p>
            <p>
              거대 목표 <strong>{hud.bossName}</strong> 수집 · 시대 점수 {hud.eraScore.toLocaleString("ko-KR")}점 · 최고 콤보 {hud.maxCombo} · 랭크 {rankFor(hud.eraScore, hud.maxCombo, hud.bossCollected)}
            </p>
            <div className="victory-totals">
              {THEMES.map((theme) => (
                <span key={theme.id}>
                  <i>{theme.icon}</i>
                  <b>{theme.label}</b>
                  <em>{hud.themeTotals[theme.id]}개</em>
                </span>
              ))}
            </div>
            <button type="button" className="primary-button" onClick={() => actionsRef.current?.restart()}>
              <span>다시 시간여행</span><b>↻</b>
            </button>
          </div>
        </section>
      ) : null}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {hud.collectedLabel ? `${hud.collectedLabel} 수집` : ""}
      </div>
    </main>
  );
}
