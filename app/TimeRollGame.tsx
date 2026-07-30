"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ThemeId = "manufacturing" | "construction" | "transport" | "communication" | "life";
type GameMode = "intro" | "playing" | "paused" | "eraClear" | "victory" | "timeUp";
type MeshName = "cube" | "sphere" | "cylinder" | "cone";

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
  collected: boolean;
  special?: boolean;
};

type Attachment = {
  theme: ThemeId;
  seed: number;
  shape: MeshName;
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
  finalReady: boolean;
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
  finalReady: boolean;
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
      completeEra: () => void;
      nextEra: () => void;
      retry: () => void;
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
  return {
    eye: [state.x, state.radius * 6.8, state.z + state.radius * 10.8],
    target: [state.x, state.radius * 0.9, state.z - state.radius * 3.2],
    up: [0, 1, 0],
    heading: 0,
    bank: 0,
    fov: Math.PI / 3.15,
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
  const radius = Math.max(state.radius, 0.01);
  const speed = Math.hypot(state.vx, state.vz);
  const speed01 = clamp(speed / (radius * 9.2), 0, 1);
  const desiredHeading = state.reducedMotion
    ? 0
    : speed > radius * 0.16
      ? Math.atan2(state.vx, -state.vz)
      : camera.heading;
  const headingDelta = wrapAngle(desiredHeading - camera.heading);
  const headingResponse = state.reducedMotion
    ? 1
    : 1 - Math.pow(0.12, dt);
  camera.heading = wrapAngle(camera.heading + headingDelta * headingResponse);

  const turnImpulse =
    (state.vx * camera.previousVz - state.vz * camera.previousVx) /
    Math.max(radius * radius * 42, 0.01);
  const desiredBank = state.reducedMotion ? 0 : clamp(turnImpulse, -1, 1) * 0.15;
  camera.bank = mix(camera.bank, desiredBank, 1 - Math.pow(0.007, dt));
  camera.previousVx = state.vx;
  camera.previousVz = state.vz;
  camera.speed01 = mix(camera.speed01, speed01, 1 - Math.pow(0.018, dt));
  const framingSpeed01 = state.reducedMotion ? 0 : camera.speed01;

  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);
  const portrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.12;
  let distance = radius * mix(10.3, 13.7, framingSpeed01);
  let height = radius * mix(6.8, 5.55, framingSpeed01);
  let lookAhead = radius * mix(3.15, 7.25, framingSpeed01);
  if (portrait) {
    distance *= 0.92;
    height *= 1.22;
    lookAhead *= 1.28;
  }
  const kick = state.reducedMotion ? 0 : state.cameraKick;
  distance += radius * kick * 0.82;
  height += radius * kick * 0.2;

  const desiredEye: Vec3 = [
    state.x - forwardX * distance + rightX * camera.bank * radius * 1.8,
    height,
    state.z - forwardZ * distance + rightZ * camera.bank * radius * 1.8,
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
  const desiredFov = state.reducedMotion
    ? Math.PI / 3.15
    : mix(Math.PI / 3.15, Math.PI / 2.66, camera.speed01);
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
  indices: number[];
};

type GpuMesh = {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
};

type DrawCommand = {
  meshName: MeshName;
  color: Vec3;
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
  alpha: number;
  gloss: number;
  distanceSquared: number;
};

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
  const indices: number[] = [];
  for (let face = 0; face < 6; face += 1) {
    const offset = face * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return { positions, normals, indices };
}

function makeSphere(rows = 9, columns = 14): RawMesh {
  const positions: number[] = [];
  const normals: number[] = [];
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
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, indices };
}

function makeCylinder(segments = 12, topRadius = 0.5, bottomRadius = 0.5): RawMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * bottomRadius, -0.5, z * bottomRadius, x * topRadius, 0.5, z * topRadius);
    normals.push(x, 0.18, z, x, 0.18, z);
  }
  for (let i = 0; i < segments; i += 1) {
    const offset = i * 2;
    indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, -0.5, 0);
  normals.push(0, -1, 0);
  const topCenter = positions.length / 3;
  positions.push(0, 0.5, 0);
  normals.push(0, 1, 0);
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(bottomCenter, next * 2, i * 2);
    if (topRadius > 0) {
      indices.push(topCenter, i * 2 + 1, next * 2 + 1);
    }
  }
  return { positions, normals, indices };
}

class WebGlToyRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private meshes: Record<MeshName, GpuMesh>;
  private positionLocation: number;
  private normalLocation: number;
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
  private viewProjection: Mat4 = new Float32Array(16);
  private canvas: HTMLCanvasElement;
  private lowQuality: boolean;
  private transparentCommands: DrawCommand[] = [];
  private cameraEye: Vec3 = [0, 0, 0];

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
        uniform mat4 uModel;
        uniform mat4 uViewProjection;
        uniform vec3 uNormalScale;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec4 world = uModel * vec4(aPosition, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(uModel) * (aNormal * uNormalScale));
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
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform vec3 uCamera;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform float uGloss;
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 lightDirection = normalize(vec3(-0.48, 0.88, 0.34));
          vec3 viewDirection = normalize(uCamera - vWorld);
          vec3 halfDirection = normalize(lightDirection + viewDirection);
          float diffuse = max(dot(normal, lightDirection), 0.0);
          float skyFill = normal.y * 0.5 + 0.5;
          float backFill = max(dot(normal, normalize(vec3(0.32, 0.55, -0.72))), 0.0);
          float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.2);
          float specular = pow(max(dot(normal, halfDirection), 0.0), mix(10.0, 42.0, uGloss));
          vec3 color =
            uColor * (0.42 + diffuse * 0.43 + skyFill * 0.10 + backFill * 0.06) +
            vec3(specular * uGloss * 0.34) +
            mix(uColor, vec3(1.0), 0.45) * rim * (0.10 + uGloss * 0.11);
          float distanceToCamera = length(uCamera - vWorld);
          float fog = smoothstep(uFogNear, uFogFar, distanceToCamera);
          color = mix(color, uFogColor, fog * 0.72);
          color = pow(max(color, vec3(0.0)), vec3(0.96));
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
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, "aPosition");
    this.normalLocation = gl.getAttribLocation(program, "aNormal");
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
    this.meshes = {
      cube: this.upload(makeCube()),
      sphere: this.upload(lowQuality ? makeSphere(9, 14) : makeSphere(14, 22)),
      cylinder: this.upload(lowQuality ? makeCylinder(12) : makeCylinder(18)),
      cone: this.upload(lowQuality ? makeCylinder(12, 0, 0.55) : makeCylinder(18, 0, 0.55)),
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

  private upload(raw: RawMesh): GpuMesh {
    if (
      raw.positions.length !== raw.normals.length ||
      raw.positions.length % 3 !== 0 ||
      raw.indices.some((index) => index >= raw.positions.length / 3)
    ) {
      throw new Error("3D 물체 데이터가 올바르지 않습니다.");
    }
    const gl = this.gl;
    const position = gl.createBuffer();
    const normal = gl.createBuffer();
    const index = gl.createBuffer();
    if (!position || !normal || !index) throw new Error("WebGL 버퍼를 만들지 못했습니다.");
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.positions), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(raw.normals), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(raw.indices), gl.STATIC_DRAW);
    return { position, normal, index, count: raw.indices.length };
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
  }

  draw(
    meshName: MeshName,
    color: Vec3,
    position: Vec3,
    scale: Vec3,
    rotation: Vec3 = [0, 0, 0],
    alpha = 1,
    gloss = 0.22,
  ) {
    if (alpha < 0.999) {
      const dx = position[0] - this.cameraEye[0];
      const dy = position[1] - this.cameraEye[1];
      const dz = position[2] - this.cameraEye[2];
      this.transparentCommands.push({
        meshName,
        color,
        position,
        scale,
        rotation,
        alpha,
        gloss,
        distanceSquared: dx * dx + dy * dy + dz * dz,
      });
      return;
    }
    this.drawImmediate({ meshName, color, position, scale, rotation, alpha, gloss, distanceSquared: 0 });
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

  private drawImmediate(command: DrawCommand) {
    const gl = this.gl;
    const mesh = this.meshes[command.meshName];
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
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}

function shapeForTheme(theme: ThemeId): MeshName {
  if (theme === "manufacturing") return "cylinder";
  if (theme === "construction") return "cube";
  if (theme === "transport") return "cube";
  if (theme === "communication") return "cone";
  return "sphere";
}

function generateItems(eraIndex: number, seed: number): Collectible[] {
  const era = ERAS[eraIndex];
  const random = seededRandom(seed + eraIndex * 971);
  const base = era.baseRadius;
  const items: Collectible[] = [];
  const focusNames = ITEM_NAMES[era.focus][eraIndex];
  const trailCount = era.goal + 5;

  for (let index = 0; index < trailCount; index += 1) {
    const sizeT = index / Math.max(1, trailCount - 1);
    items.push({
      id: items.length,
      name: focusNames[index % focusNames.length],
      theme: era.focus,
      era: eraIndex,
      x: Math.sin(index * 1.22) * base * 1.25,
      z: -base * (2.8 + index * 1.38),
      r: base * mix(0.24, 0.57, sizeT),
      yaw: random() * Math.PI * 2,
      shape: shapeForTheme(era.focus),
      collected: false,
    });
  }

  const otherThemes = THEMES.map((theme) => theme.id).filter((theme) => theme !== era.focus);
  for (let index = 0; index < 26; index += 1) {
    const theme = otherThemes[index % otherThemes.length];
    const angle = random() * Math.PI * 2;
    const distance = base * mix(4.5, era.arenaUnits * 0.9, Math.sqrt(random()));
    const names = ITEM_NAMES[theme][eraIndex];
    items.push({
      id: items.length,
      name: names[Math.floor(random() * names.length)],
      theme,
      era: eraIndex,
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      r: base * mix(0.23, 0.78, random()),
      yaw: random() * Math.PI * 2,
      shape: shapeForTheme(theme),
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
  items.push({
    id: items.length,
    name: specialNames[eraIndex],
    theme: specialTheme,
    era: eraIndex,
    x: base * 0.2,
    z: -base * 20.9,
    r: base * (eraIndex === ERAS.length - 1 ? 0.82 : 1.08),
    yaw: 0.4,
    shape: eraIndex === ERAS.length - 1 ? "sphere" : shapeForTheme(specialTheme),
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
    radius: era.baseRadius,
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
    finalReady: false,
  };
}

function formatSize(radius: number, era: number) {
  const meters = radius * [0.55, 2.2, 11, 48, 170][era];
  if (meters < 1) return `${Math.round(meters * 100)}cm`;
  if (meters < 1000) {
    return `${meters < 10 ? meters.toFixed(1) : Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(2)}km`;
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
  const canCollect =
    !!nearest &&
    nearest.r <= state.radius * 0.82 &&
    (!nearest.special || state.era < ERAS.length - 1 || state.finalReady);
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
    finalReady: state.finalReady,
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
  renderer.draw("cylinder", [0.12, 0.18, 0.19], [x, 0.01, z], [scale * 1.15, 0.025, scale * 1.15], [0, 0, 0], 0.18);

  if (eraIndex === 0) {
    renderer.draw("cube", [0.72, 0.48, 0.25], [x, scale * 0.58, z], [scale * 1.45, scale * 1.1, scale * 1.2], [0, yaw, 0], 1, 0.08);
    renderer.draw("cone", [0.86, 0.65, 0.31], [x, scale * 1.42, z], [scale * 1.35, scale * 0.95, scale * 1.35], [0, yaw, 0], 1, 0.08);
    renderer.draw("cube", dark, [x, scale * 0.45, z - scale * 0.62], [scale * 0.32, scale * 0.65, scale * 0.08], [0, yaw, 0]);
  } else if (eraIndex === 1) {
    renderer.draw("cube", dark, [x, scale * 1.35, z], [scale * 0.28, scale * 2.7, scale * 0.28], [0, yaw, 0]);
    renderer.draw("cube", focus, [x, scale * 2.6, z], [scale * 2.2, scale * 0.22, scale * 0.22], [0, yaw, -0.04]);
    const hook = rotateGroundPoint(x, z, yaw, scale * 0.92, 0);
    renderer.draw("cylinder", light, [hook[0], scale * 1.8, hook[1]], [scale * 0.1, scale * 1.35, scale * 0.1]);
    renderer.draw("cube", [0.70, 0.42, 0.22], [x, scale * 0.32, z], [scale * 1.7, scale * 0.6, scale * 1.25], [0, yaw, 0]);
  } else if (eraIndex === 2) {
    renderer.draw("cube", [0.18, 0.51, 0.74], [x, scale * 0.48, z], [scale * 2.4, scale * 0.9, scale * 1.1], [0, yaw, 0], 1, 0.18);
    renderer.draw("cube", light, [x, scale * 1.02, z], [scale * 1.25, scale * 0.35, scale * 0.9], [0, yaw, 0], 1, 0.25);
    for (const side of [-0.78, 0.78]) {
      const wheel = rotateGroundPoint(x, z, yaw, side * scale, -scale * 0.54);
      renderer.draw("cylinder", [0.08, 0.11, 0.14], [wheel[0], scale * 0.22, wheel[1]], [scale * 0.34, scale * 0.2, scale * 0.34], [Math.PI / 2, yaw, 0]);
    }
  } else if (eraIndex === 3) {
    renderer.draw("cylinder", dark, [x, scale * 1.45, z], [scale * 0.16, scale * 2.9, scale * 0.16]);
    for (let ring = 0; ring < 3; ring += 1) {
      const pulse = (time * 0.55 + ring * 0.7) % 2.1;
      renderer.draw(
        "sphere",
        focus,
        [x, scale * (2.65 + pulse * 0.1), z],
        [scale * (0.42 + pulse * 0.42), scale * 0.08, scale * (0.42 + pulse * 0.42)],
        [0, 0, 0],
        clamp(0.65 - pulse * 0.22, 0.12, 0.65),
        0.4,
      );
    }
    renderer.draw("cone", light, [x, scale * 3.0, z], [scale * 0.45, scale * 0.9, scale * 0.45], [0, yaw, 0], 1, 0.55);
  } else {
    renderer.draw("cylinder", [0.31, 0.26, 0.15], [x, scale * 0.82, z], [scale * 0.35, scale * 1.65, scale * 0.35]);
    renderer.draw("sphere", focus, [x, scale * 1.9, z], [scale * 1.55, scale * 1.3, scale * 1.55], [0, yaw, 0], 1, 0.25);
    renderer.draw("sphere", light, [x, scale * 1.7, z], [scale * 1.85, scale * 1.02, scale * 1.85], [0, -yaw, 0], 0.3, 0.72);
  }
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
  const groundEdge = mixColor(era.ground, [0.12, 0.18, 0.19], 0.18);
  const groundCenter = mixColor(era.ground, [1, 0.96, 0.78], 0.1);
  const gridColor =
    era.focus === "communication"
      ? mixColor([0.42, 0.45, 0.66], era.sky, 0.16)
      : mixColor([0.72, 0.68, 0.52], era.ground, 0.22);

  renderer.draw("cube", groundEdge, [0, -base * 0.18, 0], [half * 2.35, base * 0.36, half * 2.35], [0, 0, 0], 1, 0.04);
  renderer.draw("cube", groundCenter, [0, base * 0.005, 0], [half * 1.9, base * 0.08, half * 1.9], [0, 0, 0], 1, 0.06);

  for (let index = -6; index <= 6; index += 1) {
    const offset = index * base * 4.1;
    const strong = index === 0 ? 0.32 : 0.16;
    renderer.draw("cube", gridColor, [offset, base * 0.07, 0], [base * 0.032, base * 0.012, half * 1.82], [0, 0, 0], strong);
    renderer.draw("cube", gridColor, [0, base * 0.071, offset], [half * 1.82, base * 0.012, base * 0.032], [0, 0, 0], strong);
  }
  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);
  const sunX = state.x + forwardX * half * 0.78 - rightX * half * 0.46;
  const sunZ = state.z + forwardZ * half * 0.78 - rightZ * half * 0.46;
  renderer.draw(
    "sphere",
    [1.0, 0.78, 0.25],
    [sunX, base * 8.8, sunZ],
    [base * 2.45, base * 2.45, base * 2.45],
    [0, 0, 0],
    0.96,
    0.82,
  );
  const cloudCount = state.lowQuality ? 2 : 4;
  for (let cloudIndex = 0; cloudIndex < cloudCount; cloudIndex += 1) {
    const cloudT = cloudIndex / (cloudCount - 1);
    const side = (cloudT - 0.5) * half * 1.02;
    const drift = state.reducedMotion ? 0 : Math.sin(time * 0.09 + cloudIndex * 2.1) * base * 0.7;
    drawCloud(
      renderer,
      state.x + forwardX * half * mix(0.58, 0.9, cloudT) + rightX * (side + drift),
      base * (8.6 + (cloudIndex % 2) * 2.2),
      state.z + forwardZ * half * mix(0.58, 0.9, cloudT) + rightZ * (side + drift),
      base * mix(1.15, 1.8, (cloudIndex % 3) / 2),
      0.58,
    );
  }

  const random = seededRandom(4400 + state.era * 811);
  const landmarkCount = state.lowQuality ? 8 : 14;
  for (let index = 0; index < landmarkCount; index += 1) {
    const angle = (index / landmarkCount) * Math.PI * 2 + (random() - 0.5) * 0.16;
    const distance = half * mix(0.9, 0.98, random());
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
}

function drawItem(
  renderer: WebGlToyRenderer,
  item: Collectible,
  time: number,
  lowQuality: boolean,
) {
  const theme = THEME_BY_ID[item.theme];
  const color = theme.color;
  const bob = item.special
    ? Math.sin(time * 1.2) * item.r * 0.05
    : Math.sin(time * 1.45 + item.id * 0.73) * item.r * 0.018;
  const y = item.r * 0.48 + bob;
  const r = item.r;
  renderer.draw(
    "sphere",
    [0.10, 0.15, 0.17],
    [item.x, 0.014, item.z],
    [r * 1.18, r * 0.035, r * 0.78],
    [0, item.yaw, 0],
    item.special ? 0.07 : 0.12,
  );
  if (item.special) {
    renderer.draw(
      "sphere",
      [1.0, 0.84, 0.28],
      [item.x, r * 2.08 + bob, item.z],
      [r * 0.16, r * 0.16, r * 0.16],
      [0, 0, 0],
      0.9,
      1,
    );
  }

  if (item.special && item.theme === "life") {
    renderer.draw("cylinder", color, [item.x, r * 0.23, item.z], [r * 1.65, r * 0.35, r * 1.65], [0, 0, 0], 1, 0.32);
    renderer.draw("sphere", [0.58, 0.90, 0.83], [item.x, r * 0.62, item.z], [r * 2.08, r * 1.25, r * 2.08], [0, time * 0.08, 0], 0.62, 0.9);
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
      );
      renderer.draw(
        "sphere",
        [0.18, 0.68, 0.42],
        [item.x + Math.cos(angle) * r * 0.88, r * 0.58, item.z + Math.sin(angle) * r * 0.88],
        [r * 0.32, r * 0.48, r * 0.32],
        [0, angle, 0],
        1,
        0.28,
      );
    }
    renderer.draw("sphere", [0.98, 0.78, 0.25], [item.x, r * 1.7, item.z], [r * 0.22, r * 0.22, r * 0.22], [0, 0, 0], 1, 0.9);
    return;
  }

  if (item.theme === "manufacturing") {
    const spin = item.yaw + time * 0.14;
    renderer.draw("cylinder", color, [item.x, y, item.z], [r * 1.12, r * 0.62, r * 1.12], [0, spin, 0], 1, 0.45);
    const toothCount = lowQuality ? 4 : 8;
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
      );
    }
    renderer.draw("cylinder", [0.95, 0.92, 0.78], [item.x, y + r * 0.42, item.z], [r * 0.31, r * 0.55, r * 0.31], [0, 0, 0], 1, 0.5);
  } else if (item.theme === "construction") {
    renderer.draw("cube", color, [item.x, y, item.z], [r * 1.36, r * 0.84, r * 1.02], [0, item.yaw, 0], 1, 0.22);
    for (const side of [-0.32, 0.32]) {
      const stud = rotateGroundPoint(item.x, item.z, item.yaw, side * r, -r * 0.2);
      renderer.draw("cylinder", [0.98, 0.88, 0.54], [stud[0], y + r * 0.51, stud[1]], [r * 0.18, r * 0.22, r * 0.18], [0, 0, 0], 1, 0.38);
    }
    renderer.draw("cube", [0.19, 0.23, 0.25], [item.x, y - r * 0.08, item.z], [r * 1.46, r * 0.08, r * 1.12], [0, item.yaw, 0], 0.58);
  } else if (item.theme === "transport") {
    renderer.draw("cube", color, [item.x, y, item.z], [r * 1.68, r * 0.58, r * 1.02], [0, item.yaw, 0], 1, 0.38);
    renderer.draw("cube", [0.67, 0.90, 0.96], [item.x, y + r * 0.44, item.z], [r * 0.78, r * 0.38, r * 0.86], [0, item.yaw, 0], 0.92, 0.75);
    for (const sideX of [-0.58, 0.58]) {
      for (const sideZ of lowQuality ? [-0.42] : [-0.42, 0.42]) {
        const wheel = rotateGroundPoint(item.x, item.z, item.yaw, sideX * r, sideZ * r);
        renderer.draw("cylinder", [0.08, 0.11, 0.14], [wheel[0], r * 0.24, wheel[1]], [r * 0.29, r * 0.2, r * 0.29], [Math.PI / 2, item.yaw, 0], 1, 0.3);
      }
    }
  } else if (item.theme === "communication") {
    renderer.draw("cone", color, [item.x, y, item.z], [r * 0.78, r * 1.38, r * 0.78], [0, item.yaw, 0], 1, 0.42);
    renderer.draw("cylinder", [0.18, 0.23, 0.28], [item.x, y + r * 0.72, item.z], [r * 0.11, r * 0.75, r * 0.11], [0, 0, 0], 1, 0.45);
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
  } else {
    renderer.draw("cylinder", [0.43, 0.29, 0.17], [item.x, y - r * 0.24, item.z], [r * 0.32, r * 0.92, r * 0.32], [0, 0, 0], 1, 0.12);
    renderer.draw("sphere", color, [item.x, y + r * 0.34, item.z], [r * 1.16, r * 1.02, r * 1.16], [0, item.yaw, 0], 1, 0.3);
    renderer.draw("sphere", mixColor(color, [1, 0.96, 0.58], 0.28), [item.x - r * 0.42, y + r * 0.61, item.z - r * 0.08], [r * 0.52, r * 0.55, r * 0.52], [0, 0, 0], 1, 0.36);
    if (!lowQuality) {
      renderer.draw("sphere", mixColor(color, [0.08, 0.42, 0.25], 0.22), [item.x + r * 0.42, y + r * 0.58, item.z + r * 0.12], [r * 0.56, r * 0.6, r * 0.56], [0, 0, 0], 1, 0.28);
    }
  }
}

function drawRobot(
  renderer: WebGlToyRenderer,
  state: GameState,
  time: number,
  heading: number,
) {
  const r = state.radius;
  const speed01 = clamp(Math.hypot(state.vx, state.vz) / Math.max(r * 9.2, 0.01), 0, 1);
  const stride = Math.sin(time * mix(5.5, 10, speed01)) * r * mix(0.05, 0.15, speed01);
  const forwardX = Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  const centerX = state.x - forwardX * r * 1.7;
  const centerZ = state.z - forwardZ * r * 1.7;
  const point = (localX: number, localZ: number) =>
    rotateGroundPoint(centerX, centerZ, heading, localX, localZ);
  const leftEye = point(-r * 0.16, -r * 0.29);
  const rightEye = point(r * 0.16, -r * 0.29);
  const leftLeg = point(-r * 0.22, stride);
  const rightLeg = point(r * 0.22, -stride);
  const leftHand = point(-r * 0.62, -r * 0.34);
  const rightHand = point(r * 0.62, -r * 0.34);
  const lean = -speed01 * 0.16;

  renderer.draw("cylinder", [0.08, 0.13, 0.16], [centerX, 0.012, centerZ], [r * 0.62, 0.028, r * 0.62], [0, 0, 0], 0.2);
  renderer.draw("cube", [0.97, 0.38, 0.24], [centerX, r * 0.75, centerZ], [r * 0.78, r * 0.82, r * 0.56], [lean, heading, 0], 1, 0.36);
  renderer.draw("cube", [0.98, 0.74, 0.25], [centerX, r * 0.8, centerZ - forwardZ * r * 0.3], [r * 0.34, r * 0.28, r * 0.08], [lean, heading, 0], 1, 0.55);
  renderer.draw("sphere", [0.92, 0.96, 0.92], [centerX, r * 1.35, centerZ], [r * 0.72, r * 0.62, r * 0.66], [0, heading, 0], 1, 0.72);
  renderer.draw("sphere", [0.06, 0.16, 0.22], [leftEye[0], r * 1.42, leftEye[1]], [r * 0.09, r * 0.12, r * 0.08], [0, heading, 0], 1, 0.92);
  renderer.draw("sphere", [0.06, 0.16, 0.22], [rightEye[0], r * 1.42, rightEye[1]], [r * 0.09, r * 0.12, r * 0.08], [0, heading, 0], 1, 0.92);
  renderer.draw("cylinder", [0.20, 0.69, 0.79], [centerX, r * 1.84, centerZ], [r * 0.075, r * 0.48, r * 0.075], [0, 0, 0], 1, 0.55);
  renderer.draw("sphere", [0.98, 0.77, 0.18], [centerX, r * 2.06, centerZ], [r * 0.19, r * 0.19, r * 0.19], [0, 0, 0], 1, 0.9);
  renderer.draw("cube", [0.19, 0.45, 0.54], [leftLeg[0], r * 0.29, leftLeg[1]], [r * 0.22, r * 0.58, r * 0.25], [0, heading, 0]);
  renderer.draw("cube", [0.19, 0.45, 0.54], [rightLeg[0], r * 0.29, rightLeg[1]], [r * 0.22, r * 0.58, r * 0.25], [0, heading, 0]);
  renderer.draw("sphere", [0.96, 0.42, 0.29], [leftHand[0], r * 0.86, leftHand[1]], [r * 0.18, r * 0.18, r * 0.18], [0, 0, 0], 1, 0.45);
  renderer.draw("sphere", [0.96, 0.42, 0.29], [rightHand[0], r * 0.86, rightHand[1]], [r * 0.18, r * 0.18, r * 0.18], [0, 0, 0], 1, 0.45);
}

function drawSpeedEffects(
  renderer: WebGlToyRenderer,
  state: GameState,
  camera: CameraState,
  time: number,
) {
  if (state.reducedMotion || camera.speed01 < 0.16) return;
  const r = state.radius;
  const forwardX = Math.sin(camera.heading);
  const forwardZ = -Math.cos(camera.heading);
  const rightX = Math.cos(camera.heading);
  const rightZ = Math.sin(camera.heading);
  for (let index = 0; index < 6; index += 1) {
    const distance = r * (1.8 + index * 1.05);
    const side = Math.sin(time * 5 + index * 2.4) * r * (0.3 + index * 0.06);
    const fade = camera.speed01 * (1 - index / 7) * 0.3;
    renderer.draw(
      "sphere",
      mixColor([1.0, 0.80, 0.24], ERAS[state.era].sky, index / 8),
      [
        state.x - forwardX * distance + rightX * side,
        r * mix(0.62, 0.18, index / 6),
        state.z - forwardZ * distance + rightZ * side,
      ],
      [r * mix(0.55, 0.16, index / 6), r * 0.14, r * mix(0.9, 0.25, index / 6)],
      [0, camera.heading, 0],
      fade,
      0.72,
    );
  }
}

function drawBall(renderer: WebGlToyRenderer, state: GameState, time: number) {
  const r = state.radius;
  renderer.draw("cylinder", [0.08, 0.13, 0.16], [state.x, 0.018, state.z], [r * 1.28, 0.034, r * 1.28], [0, 0, 0], 0.22);
  renderer.draw(
    "sphere",
    [0.98, 0.66, 0.10],
    [state.x, r, state.z],
    [r * 2, r * 2, r * 2],
    [state.rollX, time * 0.15, state.rollZ],
    1,
    0.82,
  );
  renderer.draw(
    "sphere",
    [1.0, 0.91, 0.46],
    [state.x, r * 1.03, state.z],
    [r * 2.08, r * 2.08, r * 2.08],
    [state.rollX * 0.7, -time * 0.1, state.rollZ * 0.7],
    0.18,
    1,
  );
  const nodeCount = state.lowQuality ? 6 : 12;
  for (let node = 0; node < nodeCount; node += 1) {
    const angle = (node / nodeCount) * Math.PI * 2 + time * 0.34;
    const wave = Math.sin(angle * 2 + state.rollX) * r * 0.18;
    renderer.draw(
      "sphere",
      node % 2 === 0 ? [0.98, 0.33, 0.22] : [0.16, 0.72, 0.76],
      [state.x + Math.cos(angle) * r * 1.03, r + wave, state.z + Math.sin(angle) * r * 1.03],
      [r * 0.105, r * 0.105, r * 0.105],
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
    renderer.draw(
      attachment.shape,
      THEME_BY_ID[attachment.theme].color,
      [x, y, z],
      [size, size, size],
      [theta, phi + time * 0.06 + index * 0.1, theta * 0.4],
      1,
      0.5,
    );
  });
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

  for (const item of state.items) {
    if (!item.collected) drawItem(renderer, item, visualTime, state.lowQuality);
  }
  for (const particle of state.particles) {
    renderer.draw(
      "sphere",
      particle.color,
      [particle.x, particle.y, particle.z],
      [base * 0.13, base * 0.13, base * 0.13],
      [0, 0, 0],
      clamp(particle.life * 2, 0, 1),
      0.82,
    );
  }
  drawSpeedEffects(renderer, state, camera, visualTime);
  drawRobot(renderer, state, visualTime, camera.heading);
  drawBall(renderer, state, visualTime);
  renderer.flushTransparent();
}

function loadProgress() {
  if (typeof window === "undefined") return { bestEra: 0, bestSize: 0 };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVE_KEY) || "{}") as {
      bestEra?: number;
      bestSize?: number;
    };
    return {
      bestEra: clamp(Math.floor(parsed.bestEra || 0), 0, ERAS.length - 1),
      bestSize: Math.max(0, Number(parsed.bestSize) || 0),
    };
  } catch {
    return { bestEra: 0, bestSize: 0 };
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
  const [fullscreen, setFullscreen] = useState(false);
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });
  const initialHud = useMemo<HudSnapshot>(
    () => ({
      mode: "intro",
      era: 0,
      timer: ERAS[0].seconds,
      radius: ERAS[0].baseRadius,
      boost: 1,
      themeTotals: { ...EMPTY_TOTALS },
      eraCollected: 0,
      totalCollected: 0,
      collectedLabel: "",
      message: ERAS[0].mission,
      nearbyName: "",
      nearbyCanCollect: false,
      finalReady: false,
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
    const state = createState(0, reducedMotion, 20260730, lowQuality);
    const camera = createCameraState(state);
    gameRef.current = state;
    let bestEra = saved.bestEra;
    let bestSize = saved.bestSize;
    let running = true;
    let lastTime = performance.now();
    let uiAccumulator = 0;
    let manualUntil = 0;

    const save = () => {
      bestEra = Math.max(bestEra, state.era);
      bestSize = Math.max(bestSize, state.radius);
      try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify({ bestEra, bestSize }));
      } catch {
        // Local progress is optional; gameplay remains available when storage is blocked.
      }
    };

    const syncHud = (force = false) => {
      if (!force && uiAccumulator < 0.1) return;
      uiAccumulator = 0;
      setHud(makeHud(state, bestEra, bestSize));
    };

    const resetEra = (eraIndex: number, mode: GameMode = "playing") => {
      const era = ERAS[eraIndex];
      state.era = eraIndex;
      state.mode = mode;
      state.x = 0;
      state.z = 0;
      state.vx = 0;
      state.vz = 0;
      state.radius = era.baseRadius;
      state.rollX = 0;
      state.rollZ = 0;
      state.timer = era.seconds;
      state.boost = 1;
      state.items = generateItems(eraIndex, state.seed);
      state.attachments = [];
      state.particles = [];
      state.eraCollected = 0;
      state.collectedLabel = "";
      state.message = era.mission;
      state.messageTime = 4.5;
      state.cameraKick = 0;
      state.finalReady = false;
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
      const addedVolume = Math.pow(item.r, 3) * (item.special ? 0.55 : 0.7);
      state.radius = Math.cbrt(Math.pow(state.radius, 3) + addedVolume);
      state.attachments.push({ theme: item.theme, seed: item.id * 997 + state.era * 101, shape: item.shape });
      state.collectedLabel = `${THEME_BY_ID[item.theme].label} · ${item.name}`;
      state.message = `${item.name} 모았어요!`;
      state.messageTime = 1.6;
      state.shake = state.reducedMotion ? 0 : item.special ? 0.9 : 0.35;
      state.cameraKick = Math.max(state.cameraKick, item.special ? 1 : 0.42);
      if (!state.reducedMotion) {
        const random = seededRandom(item.id * 311 + state.totalCollected * 47);
        for (let index = 0; index < 10; index += 1) {
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
      if (state.eraCollected >= era.goal) {
        if (state.era === ERAS.length - 1) {
          state.finalReady = true;
          if (!item.special) {
            state.message = "마지막 목표! 앞의 미래 생태돔을 모아 보세요.";
            state.messageTime = 5;
          }
        } else {
          state.mode = "eraClear";
          state.message = `${era.name} 완성!`;
          state.messageTime = 10;
          save();
          playTone(620, 0.36, 380);
        }
      }
      if (item.special && state.era === ERAS.length - 1 && state.finalReady) {
        state.mode = "victory";
        state.message = "시간 전시관 완성!";
        state.messageTime = 20;
        bestEra = ERAS.length - 1;
        save();
        playTone(660, 0.5, 520);
      }
      syncHud(true);
    };

    const update = (dt: number) => {
      const safeDt = clamp(dt, 0, 1 / 20);
      state.messageTime = Math.max(0, state.messageTime - safeDt);
      state.bumpCooldown = Math.max(0, state.bumpCooldown - safeDt);
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
      const topSpeed = state.radius * (boosting ? 9.2 : 5.8);
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
        const specialLocked =
          item.special && state.era === ERAS.length - 1 && !state.finalReady;
        if (item.r <= state.radius * 0.82 && !specialLocked) {
          collect(item);
          if (state.mode !== "playing") break;
        } else if (state.bumpCooldown <= 0) {
          const normalX = dx / Math.max(distance, 0.001);
          const normalZ = dz / Math.max(distance, 0.001);
          const overlap = collisionDistance - distance;
          state.x -= normalX * overlap * 0.52;
          state.z -= normalZ * overlap * 0.52;
          state.vx *= -0.16;
          state.vz *= -0.16;
          state.message = specialLocked
            ? `${ERAS[state.era].goal - state.eraCollected}개 더 모으면 생태돔을 모을 수 있어요`
            : `${item.name}은 아직 커요. 작은 물건부터 모아 봐요!`;
          state.messageTime = 2.2;
          state.bumpCooldown = 0.75;
          state.shake = state.reducedMotion ? 0 : 0.25;
          playTone(190, 0.08, -50);
        }
      }

      state.timer = Math.max(0, state.timer - safeDt);
      if (state.timer <= 0) {
        state.mode = "timeUp";
        state.message = "조금만 더 굴려볼까요?";
        state.messageTime = 20;
        save();
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
          name: item.name,
          theme: THEME_BY_ID[item.theme].label,
          x: Number(item.x.toFixed(2)),
          z: Number(item.z.toFixed(2)),
          size: Number(item.r.toFixed(2)),
          distance: Number(Math.hypot(item.x - state.x, item.z - state.z).toFixed(2)),
          collectible:
            item.r <= state.radius * 0.82 &&
            (!item.special || state.era < ERAS.length - 1 || state.finalReady),
          special: !!item.special,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);
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
          velocity: { x: Number(state.vx.toFixed(2)), z: Number(state.vz.toFixed(2)) },
        },
        timerSeconds: Number(state.timer.toFixed(1)),
        boost: Number(state.boost.toFixed(2)),
        reducedMotion: state.reducedMotion,
        quality: state.lowQuality ? "mobile" : "high",
        camera: {
          heading: Number(camera.heading.toFixed(3)),
          bank: Number(camera.bank.toFixed(3)),
          fovDegrees: Number((camera.fov * 180 / Math.PI).toFixed(1)),
          speed01: Number(camera.speed01.toFixed(2)),
          eye: camera.eye.map((value) => Number(value.toFixed(2))),
          target: camera.target.map((value) => Number(value.toFixed(2))),
        },
        goal: {
          collected: state.eraCollected,
          required: ERAS[state.era].goal,
          finalReady: state.finalReady,
        },
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
        save();
        playTone(520, 0.22, 280);
      },
      retryEra: () => {
        resetEra(state.era, "playing");
        playTone(380, 0.11, 100);
      },
      restart: () => {
        state.themeTotals = { ...EMPTY_TOTALS };
        state.totalCollected = 0;
        resetEra(0, "playing");
        playTone(420, 0.14, 180);
      },
      setBoost: (active: boolean) => {
        boostPressedRef.current = active;
      },
    };

    const completeEraForTest = () => {
      const era = ERAS[state.era];
      state.eraCollected = era.goal;
      if (state.era === ERAS.length - 1) {
        state.finalReady = true;
        state.message = "마지막 목표! 미래 생태돔을 모아 보세요.";
        state.messageTime = 5;
      } else {
        state.mode = "eraClear";
        state.message = `${era.name} 완성!`;
        state.messageTime = 10;
      }
      syncHud(true);
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
        completeEra: completeEraForTest,
        nextEra: () => actionsRef.current?.nextEra(),
        retry: () => actionsRef.current?.retryEra(),
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
    };
  }, [playTone]);

  const era = ERAS[hud.era];
  const progress = clamp(hud.eraCollected / era.goal, 0, 1);
  const timerProgress = clamp(hud.timer / era.seconds, 0, 1);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
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

          <div className="mission-progress" aria-label={`${era.mission} ${hud.eraCollected}/${era.goal}`}>
            <div className="mission-row">
              <span>{THEME_BY_ID[era.focus].icon} {THEME_BY_ID[era.focus].label} 미션</span>
              <strong>{hud.eraCollected} / {era.goal}</strong>
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
            onClick={() => setSoundEnabled((enabled) => !enabled)}
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
          <div className="intro-panel">
            <div className="brand-mark" aria-hidden="true">
              <span className="brand-orbit orbit-one" />
              <span className="brand-orbit orbit-two" />
              <i>⚙</i>
            </div>
            <p className="eyebrow">5개의 시대 · 5개의 주제 · 하나의 커다란 모험</p>
            <h1 id="game-title">
              데굴데굴
              <span>시간공작소</span>
            </h1>
            <p className="intro-copy">
              시간정비 로봇 <strong>토리</strong>와 함께 시간 구슬을 굴려 보세요.
              작은 손도구부터 미래의 거대한 생태돔까지 차곡차곡 모을 수 있어요.
            </p>
            <div className="intro-themes" aria-label="게임 주제">
              {THEMES.map((theme) => (
                <span key={theme.id}>
                  <i style={{ backgroundColor: `rgb(${theme.color.map((v) => Math.round(v * 255)).join(",")})` }}>{theme.icon}</i>
                  {theme.label}
                </span>
              ))}
            </div>
            <button
              id="start-btn"
              type="button"
              className="primary-button"
              onClick={() => actionsRef.current?.start(0)}
            >
              <span>시간 구슬 굴리기</span>
              <b>→</b>
            </button>
            <p className="start-tip">방향키 또는 화면 조이스틱 하나면 충분해요</p>
          </div>
          <div className="timeline-preview" aria-label="시대 여행 순서">
            {ERAS.map((entry, index) => (
              <div key={entry.shortName}>
                <span>{index + 1}</span>
                <b>{entry.shortName}</b>
                <small>{THEME_BY_ID[entry.focus].label}</small>
              </div>
            ))}
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
            <p className="eyebrow">시대 {hud.era + 1} 완성</p>
            <h2 id="clear-title">{era.name}</h2>
            <p>
              {THEME_BY_ID[era.focus].label} 물건 {hud.eraCollected}개를 모았어요.
              다음 시대에는 물건과 시간 구슬이 훨씬 커져요!
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
            <p className="eyebrow">다섯 시대 여행 성공</p>
            <h2 id="victory-title">시간 전시관 완성!</h2>
            <p>
              제조에서 생명까지, 기술은 서로 이어지며 더 나은 미래를 만들어요.
              토리와 시간 구슬의 가장 큰 기록은 <strong>{formatSize(hud.radius, hud.era)}</strong>예요.
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
