export type RawMesh = {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
};

export type PremiumMeshOptions = {
  segments?: number;
  rings?: number;
};

const TAU = Math.PI * 2;

function clampDetail(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function pushVertex(
  mesh: RawMesh,
  position: [number, number, number],
  normal: [number, number, number],
  uv: [number, number],
) {
  const normalized = normalize3(normal);
  mesh.positions.push(position[0], position[1], position[2]);
  mesh.normals.push(normalized[0], normalized[1], normalized[2]);
  mesh.uvs.push(uv[0], uv[1]);
  return mesh.positions.length / 3 - 1;
}

function readVec3(values: number[], index: number): [number, number, number] {
  const offset = index * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function subtract(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function addTriangle(mesh: RawMesh, a: number, b: number, c: number) {
  const pa = readVec3(mesh.positions, a);
  const pb = readVec3(mesh.positions, b);
  const pc = readVec3(mesh.positions, c);
  const faceNormal = cross(subtract(pb, pa), subtract(pc, pa));
  const na = readVec3(mesh.normals, a);
  const nb = readVec3(mesh.normals, b);
  const nc = readVec3(mesh.normals, c);
  const expected: [number, number, number] = [
    na[0] + nb[0] + nc[0],
    na[1] + nb[1] + nc[1],
    na[2] + nb[2] + nc[2],
  ];
  if (dot(faceNormal, expected) < 0) {
    mesh.indices.push(a, c, b);
  } else {
    mesh.indices.push(a, b, c);
  }
}

function addQuad(mesh: RawMesh, a: number, b: number, c: number, d: number) {
  addTriangle(mesh, a, b, c);
  addTriangle(mesh, a, c, d);
}

function signedPow(value: number, exponent: number) {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

export function makeRoundedBox(options: PremiumMeshOptions = {}): RawMesh {
  const segments = clampDetail(options.segments, 20, 3, 28);
  const rings = clampDetail(options.rings, Math.max(6, Math.ceil(segments / 2)), 2, 14);
  const mesh: RawMesh = { positions: [], normals: [], uvs: [], indices: [] };
  const exponent = 0.42;
  const top = pushVertex(mesh, [0, 0.5, 0], [0, 1, 0], [0.5, 0]);
  const rows: number[][] = [];

  for (let row = 1; row < rings; row += 1) {
    const v = row / rings;
    const phi = Math.PI * 0.5 - v * Math.PI;
    const cosPhi = Math.cos(phi);
    const y = signedPow(Math.sin(phi), exponent) * 0.5;
    const ringRadius = Math.abs(cosPhi) ** exponent * 0.5;
    const rowIndices: number[] = [];
    for (let column = 0; column < segments; column += 1) {
      const u = column / segments;
      const theta = u * TAU;
      const x = signedPow(Math.cos(theta), exponent) * ringRadius;
      const z = signedPow(Math.sin(theta), exponent) * ringRadius;
      rowIndices.push(pushVertex(mesh, [x, y, z], normalize3([x, y, z]), [u, v]));
    }
    rows.push(rowIndices);
  }

  const bottom = pushVertex(mesh, [0, -0.5, 0], [0, -1, 0], [0.5, 1]);
  for (let column = 0; column < segments; column += 1) {
    const next = (column + 1) % segments;
    addTriangle(mesh, top, rows[0][column], rows[0][next]);
  }
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const next = (column + 1) % segments;
      addQuad(mesh, rows[row][column], rows[row + 1][column], rows[row + 1][next], rows[row][next]);
    }
  }
  const last = rows[rows.length - 1];
  for (let column = 0; column < segments; column += 1) {
    const next = (column + 1) % segments;
    addTriangle(mesh, bottom, last[next], last[column]);
  }
  return mesh;
}

export function makeCapsule(options: PremiumMeshOptions = {}): RawMesh {
  const segments = clampDetail(options.segments, 14, 8, 24);
  const rings = clampDetail(options.rings, 5, 3, 8);
  const mesh: RawMesh = { positions: [], normals: [], uvs: [], indices: [] };
  const capRadius = 0.28;
  const cylinderHalf = 0.22;
  const top = pushVertex(mesh, [0, cylinderHalf + capRadius, 0], [0, 1, 0], [0.5, 0]);
  const rows: number[][] = [];

  for (let row = 1; row <= rings; row += 1) {
    const t = row / rings;
    const phi = t * Math.PI * 0.5;
    const y = cylinderHalf + Math.cos(phi) * capRadius;
    const radius = Math.sin(phi) * capRadius;
    const rowIndices: number[] = [];
    for (let column = 0; column < segments; column += 1) {
      const u = column / segments;
      const angle = u * TAU;
      rowIndices.push(pushVertex(
        mesh,
        [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
        [Math.cos(angle) * Math.sin(phi), Math.cos(phi), Math.sin(angle) * Math.sin(phi)],
        [u, t * 0.32],
      ));
    }
    rows.push(rowIndices);
  }

  const bottomCylinder: number[] = [];
  for (let column = 0; column < segments; column += 1) {
    const u = column / segments;
    const angle = u * TAU;
    bottomCylinder.push(pushVertex(
      mesh,
      [Math.cos(angle) * capRadius, -cylinderHalf, Math.sin(angle) * capRadius],
      [Math.cos(angle), 0, Math.sin(angle)],
      [u, 0.66],
    ));
  }
  rows.push(bottomCylinder);

  for (let row = rings - 1; row >= 1; row -= 1) {
    const t = row / rings;
    const phi = t * Math.PI * 0.5;
    const y = -cylinderHalf - Math.cos(phi) * capRadius;
    const radius = Math.sin(phi) * capRadius;
    const rowIndices: number[] = [];
    for (let column = 0; column < segments; column += 1) {
      const u = column / segments;
      const angle = u * TAU;
      rowIndices.push(pushVertex(
        mesh,
        [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
        [Math.cos(angle) * Math.sin(phi), -Math.cos(phi), Math.sin(angle) * Math.sin(phi)],
        [u, 1 - t * 0.32],
      ));
    }
    rows.push(rowIndices);
  }

  const bottom = pushVertex(mesh, [0, -cylinderHalf - capRadius, 0], [0, -1, 0], [0.5, 1]);
  for (let column = 0; column < segments; column += 1) {
    const next = (column + 1) % segments;
    addTriangle(mesh, top, rows[0][column], rows[0][next]);
  }
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const next = (column + 1) % segments;
      addQuad(mesh, rows[row][column], rows[row + 1][column], rows[row + 1][next], rows[row][next]);
    }
  }
  const last = rows[rows.length - 1];
  for (let column = 0; column < segments; column += 1) {
    const next = (column + 1) % segments;
    addTriangle(mesh, bottom, last[next], last[column]);
  }
  return mesh;
}

export function makeTorus(options: PremiumMeshOptions = {}): RawMesh {
  const segments = clampDetail(options.segments, 20, 10, 32);
  const rings = clampDetail(options.rings, 8, 4, 14);
  const mesh: RawMesh = { positions: [], normals: [], uvs: [], indices: [] };
  const major = 0.34;
  const minor = 0.12;
  const rows: number[][] = [];

  for (let segment = 0; segment < segments; segment += 1) {
    const u = segment / segments;
    const theta = u * TAU;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const row: number[] = [];
    for (let ring = 0; ring < rings; ring += 1) {
      const v = ring / rings;
      const phi = v * TAU;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const radius = major + minor * cosPhi;
      row.push(pushVertex(
        mesh,
        [radius * cosTheta, minor * sinPhi, radius * sinTheta],
        [cosTheta * cosPhi, sinPhi, sinTheta * cosPhi],
        [u, v],
      ));
    }
    rows.push(row);
  }

  for (let segment = 0; segment < segments; segment += 1) {
    const nextSegment = (segment + 1) % segments;
    for (let ring = 0; ring < rings; ring += 1) {
      const nextRing = (ring + 1) % rings;
      addQuad(mesh, rows[segment][ring], rows[nextSegment][ring], rows[nextSegment][nextRing], rows[segment][nextRing]);
    }
  }
  return mesh;
}

export const makeRing = makeTorus;

export function makeDish(options: PremiumMeshOptions = {}): RawMesh {
  const segments = clampDetail(options.segments, 18, 8, 32);
  const rings = clampDetail(options.rings, 5, 3, 8);
  const mesh: RawMesh = { positions: [], normals: [], uvs: [], indices: [] };
  const center = pushVertex(mesh, [0, 0, 0], [0, 1, 0], [0.5, 0.5]);
  const rows: number[][] = [];

  for (let row = 1; row <= rings; row += 1) {
    const v = row / rings;
    const radius = v * 0.5;
    const y = -0.16 * v * v;
    const rowIndices: number[] = [];
    for (let column = 0; column < segments; column += 1) {
      const u = column / segments;
      const angle = u * TAU;
      const nx = Math.cos(angle) * 0.38;
      const nz = Math.sin(angle) * 0.38;
      rowIndices.push(pushVertex(mesh, [Math.cos(angle) * radius, y, Math.sin(angle) * radius], [nx, 0.92, nz], [u, v]));
    }
    rows.push(rowIndices);
  }

  for (let column = 0; column < segments; column += 1) {
    const next = (column + 1) % segments;
    addTriangle(mesh, center, rows[0][column], rows[0][next]);
  }
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const next = (column + 1) % segments;
      addQuad(mesh, rows[row][column], rows[row + 1][column], rows[row + 1][next], rows[row][next]);
    }
  }
  return mesh;
}

function addPrism(
  mesh: RawMesh,
  corners: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]],
  depth: number,
) {
  const front = corners.map((point) => [point[0], point[1], depth] as [number, number, number]);
  const back = corners.map((point) => [point[0], point[1], -depth] as [number, number, number]);
  const faces: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ][] = [
    [front[0], front[1], front[2], front[3], [0, 0, 1]],
    [back[1], back[0], back[3], back[2], [0, 0, -1]],
    [front[3], front[2], back[2], back[3], [0, 1, 0]],
    [front[1], front[0], back[0], back[1], [0, -1, 0]],
    [front[1], back[1], back[2], front[2], [1, 0, 0]],
    [front[0], front[3], back[3], back[0], [-1, 0, 0]],
  ];
  for (const face of faces) {
    const base = mesh.positions.length / 3;
    const normal = face[4];
    for (let index = 0; index < 4; index += 1) {
      pushVertex(mesh, face[index], normal, [[0, 0], [1, 0], [1, 1], [0, 1]][index] as [number, number]);
    }
    addQuad(mesh, base, base + 1, base + 2, base + 3);
  }
}

function addFaceFromPoints(
  mesh: RawMesh,
  points: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]],
) {
  const normal = normalize3(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
  const base = mesh.positions.length / 3;
  for (let index = 0; index < 4; index += 1) {
    pushVertex(mesh, points[index], normal, [[0, 0], [1, 0], [1, 1], [0, 1]][index] as [number, number]);
  }
  addQuad(mesh, base, base + 1, base + 2, base + 3);
}

export function makeTruss(options: PremiumMeshOptions = {}): RawMesh {
  const bays = clampDetail(options.segments, 4, 2, 8);
  const mesh: RawMesh = { positions: [], normals: [], uvs: [], indices: [] };
  const addRect = (cx: number, cy: number, width: number, height: number) => {
    addPrism(mesh, [
      [cx - width / 2, cy - height / 2, 0],
      [cx + width / 2, cy - height / 2, 0],
      [cx + width / 2, cy + height / 2, 0],
      [cx - width / 2, cy + height / 2, 0],
    ], 0.08);
  };

  addRect(0, -0.42, 1, 0.12);
  addRect(0, 0.42, 1, 0.12);
  for (let bay = 0; bay < bays; bay += 1) {
    const x = -0.5 + (bay + 0.5) / bays;
    addRect(x, 0, 0.08, 0.86);
    addRect(x, bay % 2 === 0 ? 0.16 : -0.16, 0.08, 0.64);
  }
  return mesh;
}

export function makeWheel(options: PremiumMeshOptions = {}): RawMesh {
  const mesh = makeTorus({ segments: options.segments ?? 18, rings: options.rings ?? 6 });
  const spokes = clampDetail(options.segments, 6, 5, 10);
  const inner = 0.08;
  const outer = 0.31;
  const halfWidth = 0.045;
  for (let spoke = 0; spoke < spokes; spoke += 1) {
    const angle = (spoke / spokes) * TAU;
    const side = 0.055;
    const tangent = [-Math.sin(angle) * side, Math.cos(angle) * side] as const;
    const radial = [Math.cos(angle), Math.sin(angle)] as const;
    const top: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] = [
      [radial[0] * inner + tangent[0], halfWidth, radial[1] * inner + tangent[1]],
      [radial[0] * outer + tangent[0], halfWidth, radial[1] * outer + tangent[1]],
      [radial[0] * outer - tangent[0], halfWidth, radial[1] * outer - tangent[1]],
      [radial[0] * inner - tangent[0], halfWidth, radial[1] * inner - tangent[1]],
    ];
    const bottom = top.map((point) => [point[0], -halfWidth, point[2]] as [number, number, number]) as typeof top;
    addFaceFromPoints(mesh, [top[0], top[1], top[2], top[3]]);
    addFaceFromPoints(mesh, [bottom[3], bottom[2], bottom[1], bottom[0]]);
    addFaceFromPoints(mesh, [top[1], bottom[1], bottom[2], top[2]]);
    addFaceFromPoints(mesh, [top[3], bottom[3], bottom[0], top[0]]);
    addFaceFromPoints(mesh, [top[0], bottom[0], bottom[1], top[1]]);
    addFaceFromPoints(mesh, [top[2], bottom[2], bottom[3], top[3]]);
  }
  return mesh;
}
