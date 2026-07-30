import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_VERTICES = 65535;
const MAX_TRIANGLES_PER_MESH = 5000;
const MIN_TRIANGLE_AREA = 1e-10;

const assets = [
  ["kenneyFactoryCogA", "kenney-factory-kit", "cog-a"],
  ["kenneyFactoryConveyorLong", "kenney-factory-kit", "conveyor-long"],
  ["kenneyFactoryScannerHigh", "kenney-factory-kit", "scanner-high"],
  ["kenneyFactoryScreenWide", "kenney-factory-kit", "screen-wide"],
  ["kenneyCarWheelDefault", "kenney-car-kit", "wheel-default"],
  ["kenneyCarCone", "kenney-car-kit", "cone"],
  ["kenneyNatureTreeOak", "kenney-nature-kit", "tree_oak"],
  ["kenneyNatureMushroomRed", "kenney-nature-kit", "mushroom_red"],
];

const cc0Dir = path.join("public", "assets", "cc0");
const outputFile = path.join("app", "timeRollCc0Meshes.ts");

function parseTuple(parts, expected, lineNumber) {
  if (parts.length < expected + 1) {
    throw new Error(`Line ${lineNumber}: expected ${expected} numeric components`);
  }
  return parts.slice(1, expected + 1).map((part) => {
    const value = Number(part);
    if (!Number.isFinite(value)) {
      throw new Error(`Line ${lineNumber}: invalid number "${part}"`);
    }
    return value;
  });
}

function parseFaceRef(token, counts, lineNumber) {
  const [vRaw, vtRaw, vnRaw] = token.split("/");
  const v = Number(vRaw);
  const vt = vtRaw ? Number(vtRaw) : 0;
  const vn = vnRaw ? Number(vnRaw) : 0;
  if (!Number.isInteger(v) || v === 0) {
    throw new Error(`Line ${lineNumber}: invalid vertex reference "${token}"`);
  }
  const resolve = (index, count) => (index > 0 ? index - 1 : count + index);
  return {
    position: resolve(v, counts.positions),
    uv: vt ? resolve(vt, counts.uvs) : -1,
    normal: vn ? resolve(vn, counts.normals) : -1,
  };
}

function pushGeneratedNormal(normals, positions, refs) {
  const [ax, ay, az] = positions[refs[0].position];
  const [bx, by, bz] = positions[refs[1].position];
  const [cx, cy, cz] = positions[refs[2].position];
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  normals.push(nx / length, ny / length, nz / length);
}

function triangleArea(sourcePositions, refs) {
  const [aRef, bRef, cRef] = refs;
  const a = sourcePositions[aRef.position];
  const b = sourcePositions[bRef.position];
  const c = sourcePositions[cRef.position];
  if (!a || !b || !c) {
    return 0;
  }
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) * 0.5;
}

function triangleKey(refs) {
  return refs.map((ref) => `${ref.position}/${ref.uv}/${ref.normal}`).join("|");
}

function parseObj(source, name) {
  const sourcePositions = [];
  const sourceNormals = [];
  const sourceUvs = [];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const vertexMap = new Map();
  const triangleKeys = new Set();

  const lines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1;
    const trimmed = lines[lineIndex].trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts[0] === "v") {
      sourcePositions.push(parseTuple(parts, 3, lineNumber));
    } else if (parts[0] === "vn") {
      sourceNormals.push(parseTuple(parts, 3, lineNumber));
    } else if (parts[0] === "vt") {
      sourceUvs.push(parseTuple(parts, 2, lineNumber));
    } else if (parts[0] === "f") {
      const refs = parts.slice(1).map((part) =>
        parseFaceRef(part, {
          positions: sourcePositions.length,
          normals: sourceNormals.length,
          uvs: sourceUvs.length,
        }, lineNumber),
      );
      for (let fan = 1; fan < refs.length - 1; fan += 1) {
        const tri = [refs[0], refs[fan], refs[fan + 1]];
        if (triangleArea(sourcePositions, tri) <= MIN_TRIANGLE_AREA) {
          continue;
        }
        const key = triangleKey(tri);
        if (triangleKeys.has(key)) {
          continue;
        }
        triangleKeys.add(key);
        for (const ref of tri) {
          const key = `${ref.position}/${ref.uv}/${ref.normal}`;
          let index = vertexMap.get(key);
          if (index === undefined) {
            const position = sourcePositions[ref.position];
            if (!position) {
              throw new Error(`Line ${lineNumber}: position index out of range`);
            }
            index = positions.length / 3;
            vertexMap.set(key, index);
            positions.push(position[0], position[1], position[2]);
            const normal = sourceNormals[ref.normal];
            if (normal) {
              normals.push(normal[0], normal[1], normal[2]);
            } else {
              pushGeneratedNormal(normals, sourcePositions, tri);
            }
            const uv = sourceUvs[ref.uv] ?? [0.5, 0.5];
            uvs.push(uv[0], 1 - uv[1]);
          }
          indices.push(index);
        }
      }
    }
  }

  if (positions.length / 3 > MAX_VERTICES) {
    throw new Error(`${name}: ${positions.length / 3} vertices exceed ${MAX_VERTICES}`);
  }
  if (indices.length / 3 > MAX_TRIANGLES_PER_MESH) {
    throw new Error(`${name}: ${indices.length / 3} triangles exceed ${MAX_TRIANGLES_PER_MESH}`);
  }
  if (positions.length === 0 || indices.length === 0) {
    throw new Error(`${name}: no renderable triangles`);
  }

  return { positions, normals, uvs, indices };
}

function formatArray(values) {
  const body = values
    .map((value) => Number(value.toFixed(6)).toString())
    .join(", ");
  return `[${body}]`;
}

function toConst(name, mesh) {
  return [
    `const ${name}: RawMesh = {`,
    `  positions: ${formatArray(mesh.positions)},`,
    `  normals: ${formatArray(mesh.normals)},`,
    `  uvs: ${formatArray(mesh.uvs)},`,
    `  indices: ${formatArray(mesh.indices)},`,
    "};",
  ].join("\n");
}

const chunks = [
  "// Generated by scripts/import-obj-to-rawmesh.mjs from selected Kenney Factory, Car, and Nature Kit CC0 OBJ sources.",
  "// Do not hand-edit mesh numbers; rerun the script after changing selected source assets.",
  "",
  "export type RawMesh = {",
  "  positions: number[];",
  "  normals: number[];",
  "  uvs: number[];",
  "  indices: number[];",
  "};",
  "",
];

const exportedNames = [];
for (const [exportName, kitDir, fileBase] of assets) {
  const objPath = path.join(cc0Dir, kitDir, "obj", `${fileBase}.obj`);
  const source = await readFile(objPath, "utf8");
  const mesh = parseObj(source, fileBase);
  chunks.push(toConst(exportName, mesh), "");
  exportedNames.push(exportName);
}

chunks.push("export const KENNEY_FACTORY_MESHES = {");
for (const name of exportedNames) {
  chunks.push(`  ${name},`);
}
chunks.push("} as const;");

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${chunks.join("\n")}\n`);
