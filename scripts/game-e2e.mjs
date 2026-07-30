import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const url = process.env.GAME_URL || "http://localhost:3000";
const saveKey = "time-roll-workshop-v1";
const outputDir = new URL("../output/e2e/", import.meta.url);
const expectedVisualAssetPaths = [
  "/textures/time-roll-material-atlas-5x5.png",
  "/textures/time-roll-object-atlas-10x5.png",
  "/textures/time-roll-object-atlas-environment-10x5.png",
  "/textures/time-roll-facade-atlas-5x5.png",
];
const eraGeometry = [
  { baseRadius: 0.82, arenaUnits: 22, setPieceTopRatio: 2.14 * 1.95 },
  { baseRadius: 1.48, arenaUnits: 23, setPieceTopRatio: 2.71 * 1.95 },
  { baseRadius: 2.72, arenaUnits: 24, setPieceTopRatio: 1.195 * 1.95 },
  { baseRadius: 4.95, arenaUnits: 25, setPieceTopRatio: 3.45 * 1.95 },
  { baseRadius: 8.9, arenaUnits: 26, setPieceTopRatio: 3.2 * 1.95 },
];
await mkdir(outputDir, { recursive: true });

const errors = [];
const checks = [];
const observations = {};
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

async function readState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "render_game_to_text should return game state");
  return JSON.parse(raw);
}

async function readProgress(page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), saveKey);
  assert.ok(raw, "progress should be saved to localStorage");
  return JSON.parse(raw);
}

async function callTestHook(page, name, ...args) {
  return page.evaluate(
    ([hookName, hookArgs]) => {
      const hook = window.__timeRollTest?.[hookName];
      if (typeof hook !== "function") throw new Error(`missing __timeRollTest.${hookName}`);
      return hook(...hookArgs);
    },
    [name, args],
  );
}

async function prepareStorage(page, value) {
  await page.addInitScript(
    ([key, storedValue]) => {
      const seedKey = `${key}:e2e-seeded`;
      if (window.sessionStorage.getItem(seedKey) === "1") return;
      window.sessionStorage.setItem(seedKey, "1");
      if (storedValue === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, storedValue);
      }
    },
    [saveKey, value === null ? null : JSON.stringify(value)],
  );
}

function findOversizedItem(state) {
  const item = state.nearby
    .filter((entry) => !entry.special && !entry.collectible)
    .sort((a, b) => a.requiredRadius - b.requiredRadius)[0];
  assert.ok(item, `expected an oversized non-boss item near player; nearby=${JSON.stringify(state.nearby)}`);
  return item;
}

async function collectNaturalEraOneGrowth(page) {
  const tiers = [];
  const collectedIds = [];
  let bossUnlockedAt = null;
  let state = await readState(page);

  tiers.push(state.player.growthTier);
  for (let pass = 0; pass < 20; pass += 1) {
    let collectedThisPass = 0;

    for (let id = 0; id <= 97; id += 1) {
      if (await callTestHook(page, "collectItem", id)) {
        collectedThisPass += 1;
        collectedIds.push(id);
        state = await readState(page);
        if (tiers.at(-1) !== state.player.growthTier) tiers.push(state.player.growthTier);
        if (state.goal.bossReady && bossUnlockedAt === null) bossUnlockedAt = collectedIds.length;
        if (state.goal.bossReady && state.goal.bossTarget?.collectible) {
          return { state, tiers, collectedIds, bossUnlockedAt, passes: pass + 1 };
        }
      }
    }

    state = await readState(page);
    if (tiers.at(-1) !== state.player.growthTier) tiers.push(state.player.growthTier);
    if (state.goal.bossReady && bossUnlockedAt === null) bossUnlockedAt = collectedIds.length;
    if (state.goal.bossReady && state.goal.bossTarget?.collectible) {
      return { state, tiers, collectedIds, bossUnlockedAt, passes: pass + 1 };
    }
    if (collectedThisPass === 0) break;
  }

  return { state, tiers, collectedIds, bossUnlockedAt, passes: 20 };
}

function trackErrors(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${String(error)}`));
}

function outputPath(filename) {
  return new URL(filename, outputDir).pathname;
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

async function captureCanvas(page, filename) {
  const path = outputPath(filename);
  const canvas = page.locator("canvas");
  await canvas.waitFor({ state: "visible" });
  await canvas.screenshot({ path });
  const metadata = await sharp(path).metadata();
  const statistics = await sharp(path).stats();
  assert.ok((metadata.width ?? 0) >= 640, `${filename} should have a useful width`);
  assert.ok((metadata.height ?? 0) >= 360, `${filename} should have a useful height`);
  assert.ok(
    statistics.channels.slice(0, 3).some((channel) => channel.stdev > 8),
    `${filename} should contain a non-blank rendered scene`,
  );
  return path;
}

async function waitForVisualAssets(page) {
  await page.waitForFunction(
    (expectedPaths) => {
      const loadedPaths = new Set(
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("/textures/time-roll-") && entry.responseEnd > 0)
          .map((entry) => new URL(entry.name).pathname),
      );
      return expectedPaths.every((path) => loadedPaths.has(path));
    },
    expectedVisualAssetPaths,
    { timeout: 10_000 },
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

async function imageDifference(leftPath, rightPath) {
  const [left, right] = await Promise.all([
    sharp(leftPath).resize(160, 90, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    sharp(rightPath).resize(160, 90, { fit: "fill" }).removeAlpha().raw().toBuffer(),
  ]);
  assert.equal(left.length, right.length);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  return Number((difference / left.length).toFixed(2));
}

async function countVividMagentaPixels(path) {
  const { data } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += 3) {
    if (data[index] >= 235 && data[index + 1] <= 35 && data[index + 2] >= 235) {
      count += 1;
    }
  }
  return count;
}

function projectSetPieceVerticalSpan(camera, worldZ, topY, viewportHeight) {
  const forwardY = camera.target[1] - camera.eye[1];
  const forwardZ = camera.target[2] - camera.eye[2];
  const forwardLength = Math.hypot(forwardY, forwardZ);
  const normalizedForwardY = forwardY / forwardLength;
  const normalizedForwardZ = forwardZ / forwardLength;
  const upY = -normalizedForwardZ;
  const upZ = normalizedForwardY;
  const tangent = Math.tan((camera.fovDegrees * Math.PI) / 360);
  const projectY = (worldY) => {
    const relativeY = worldY - camera.eye[1];
    const relativeZ = worldZ - camera.eye[2];
    const depth = relativeY * normalizedForwardY + relativeZ * normalizedForwardZ;
    const vertical = relativeY * upY + relativeZ * upZ;
    const normalizedY = vertical / (depth * tangent);
    return ((1 - normalizedY) * viewportHeight) / 2;
  };
  const projectedTop = projectY(topY);
  const projectedBase = projectY(0);
  const visibleTop = Math.max(0, Math.min(viewportHeight, projectedTop));
  const visibleBase = Math.max(0, Math.min(viewportHeight, projectedBase));
  return {
    topPx: Number(projectedTop.toFixed(1)),
    basePx: Number(projectedBase.toFixed(1)),
    visibleHeightPx: Number(Math.abs(visibleBase - visibleTop).toFixed(1)),
  };
}

function escapeSvgText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function buildContactSheet(cards, filename, columns, tileWidth = 480, tileHeight = 270) {
  const labelHeight = 42;
  const rows = Math.ceil(cards.length / columns);
  const cardHeight = labelHeight + tileHeight;
  const composites = [];

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * tileWidth;
    const top = row * cardHeight;
    const image = await sharp(card.path)
      .resize(tileWidth, tileHeight, { fit: "cover" })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg width="${tileWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#111827"/>
        <text x="18" y="28" fill="#f9fafb" font-size="20" font-family="Arial, sans-serif" font-weight="700">${escapeSvgText(card.label)}</text>
      </svg>`,
    );
    composites.push({ input: label, left, top });
    composites.push({ input: image, left, top: top + labelHeight });
  }

  const path = outputPath(filename);
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * cardHeight,
      channels: 3,
      background: "#0b1020",
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
  return path;
}

try {
  const migration = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  trackErrors(migration, "migration");
  await prepareStorage(migration, { bestEra: 2.8, bestSize: 12.5 });
  await migration.goto(url, { waitUntil: "domcontentloaded" });
  await migration.waitForSelector("#start-btn");
  await migration.waitForFunction(() => document.body.innerText.includes("이어서 굴리기"));
  assert.equal(await migration.getByRole("button", { name: "이어서 굴리기" }).isVisible(), true);
  assert.equal(await migration.locator(".era-node.is-unlocked").count(), 3);
  await migration.getByRole("button", { name: "이어서 굴리기" }).click();
  await migration.waitForFunction(() => window.render_game_to_text?.().includes("\"mode\":\"playing\""));
  await migration.getByRole("button", { name: "소리 끄기" }).click();
  let progress = await readProgress(migration);
  assert.equal(progress.version, 2);
  assert.equal(progress.bestEra, 2);
  assert.equal(progress.bestSize, 12.5);
  assert.deepEqual(progress.eras, {});
  assert.equal(progress.soundEnabled, false);
  await migration.reload({ waitUntil: "domcontentloaded" });
  await migration.waitForSelector("#start-btn");
  await migration.waitForFunction(() => !!document.querySelector('button[aria-label="소리 켜기"]'));
  assert.equal(await migration.getByRole("button", { name: "소리 켜기" }).isVisible(), true);
  progress = await readProgress(migration);
  assert.equal(progress.soundEnabled, false);
  observations.migratedProgress = {
    version: progress.version,
    bestEra: progress.bestEra,
    bestSize: progress.bestSize,
    soundEnabled: progress.soundEnabled,
  };
  checks.push("v1 progress migrates to v2 and sound toggle survives reload");
  await migration.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  trackErrors(desktop, "desktop");
  await prepareStorage(desktop, null);
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  await desktop.waitForSelector("#start-btn");
  await desktop.screenshot({ path: new URL("desktop-intro.png", outputDir).pathname, fullPage: true });
  assert.equal(await desktop.locator("canvas").count(), 1);
  assert.match(await desktop.locator("body").innerText(), /로봇 토리/);
  assert.match(await desktop.locator("body").innerText(), /시간동력핵/);
  assert.match(await desktop.locator("body").innerText(), /데굴데굴\s*시간공작소/);
  assert.equal(await desktop.getByRole("button", { name: "처음 시작" }).isVisible(), true);
  checks.push("landing contains robot Tori story and title CTA");

  await desktop.click("#start-btn");
  await waitForVisualAssets(desktop);
  let state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 1);
  assert.equal(state.player.growthTier, "tiny");
  assert.ok(state.player.growthRatio < 0.2);
  await desktop.screenshot({ path: new URL("desktop-playing-start.png", outputDir).pathname, fullPage: true });

  const robotHeadingCases = [
    { label: "Front 0 deg", slug: "front-0deg", heading: 0 },
    { label: "Right +90 deg", slug: "right-plus90deg", heading: Math.PI / 2 },
    { label: "Left -90 deg", slug: "left-minus90deg", heading: -Math.PI / 2 },
    { label: "Back 180 deg", slug: "back-180deg", heading: Math.PI },
  ];
  const robotHeadingCards = [];
  const robotHeadingStates = [];
  for (const headingCase of robotHeadingCases) {
    await callTestHook(desktop, "setCameraHeading", headingCase.heading);
    state = await readState(desktop);
    assert.ok(
      angleDistance(state.camera.heading, headingCase.heading) <= 0.006,
      `${headingCase.label} should set camera heading exactly; actual=${state.camera.heading}`,
    );
    const path = await captureCanvas(desktop, `robot-heading-${headingCase.slug}.png`);
    robotHeadingCards.push({ label: headingCase.label, path });
    robotHeadingStates.push({
      label: headingCase.label,
      requested: Number(headingCase.heading.toFixed(3)),
      actual: state.camera.heading,
      camera: state.camera,
      renderStats: state.renderStats,
      screenshot: `robot-heading-${headingCase.slug}.png`,
    });
  }
  const robotHeadingDifferences = [];
  for (let index = 1; index < robotHeadingCards.length; index += 1) {
    const difference = await imageDifference(robotHeadingCards[0].path, robotHeadingCards[index].path);
    assert.ok(difference >= 2, `${robotHeadingCards[index].label} should render a visibly different view`);
    robotHeadingDifferences.push({
      comparison: `${robotHeadingCards[0].label} vs ${robotHeadingCards[index].label}`,
      meanAbsolutePixelDifference: difference,
    });
  }
  await buildContactSheet(robotHeadingCards, "robot-heading-contact-sheet.png", 2, 640, 360);
  observations.robotHeadingRegression = {
    headings: robotHeadingStates,
    differences: robotHeadingDifferences,
    contactSheet: "robot-heading-contact-sheet.png",
  };
  checks.push("robot renders at exact 0, +90, -90, and 180 degree headings");

  await callTestHook(desktop, "startEra", 0);
  await callTestHook(desktop, "setCameraHeading", 0);
  state = await readState(desktop);
  const oversized = findOversizedItem(state);
  assert.equal(await callTestHook(desktop, "warpToItem", oversized.id), true);
  assert.equal(await callTestHook(desktop, "collectItem", oversized.id), false);
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.lastCollection, "");
  await desktop.evaluate(() => window.advanceTime?.(100));
  state = await readState(desktop);
  const pushedOversized = state.nearby.find((entry) => entry.id === oversized.id);
  assert.ok(pushedOversized, "oversized collision target should remain in the world");
  const oversizedCollisionDistance = state.player.radius + pushedOversized.size * 0.58;
  assert.ok(
    pushedOversized.distance >= oversizedCollisionDistance - 0.03,
    `oversized item should push clear of the player; distance=${pushedOversized.distance}, threshold=${oversizedCollisionDistance}`,
  );
  observations.oversizedCollisionSeparation = {
    item: pushedOversized.name,
    distance: pushedOversized.distance,
    collisionDistance: Number(oversizedCollisionDistance.toFixed(3)),
    blockedCollision: state.blockedCollision,
  };
  checks.push("oversized collision pushes clear even while bump feedback is cooling down");
  checks.push("starts tiny and blocks an oversized item");

  await callTestHook(desktop, "setRadiusRatio", (oversized.requiredRadius * 1.02) / (state.player.radius / state.player.growthRatio));
  assert.equal(await callTestHook(desktop, "collectItem", oversized.id), true);
  state = await readState(desktop);
  assert.equal(state.lastCollection.startsWith(oversized.name), true);
  assert.ok(["small", "medium", "large", "monument"].includes(state.player.growthTier));
  checks.push("same oversized item collects after deterministic size setup");

  await callTestHook(desktop, "startEra", 0);
  state = await readState(desktop);
  const boss = state.goal.bossTarget;
  assert.ok(boss, "first era should expose a boss target");
  await callTestHook(desktop, "setRadiusRatio", 0.75);
  assert.equal(await callTestHook(desktop, "collectItem", boss.id), false);
  state = await readState(desktop);
  assert.equal(state.goal.bossReady, false);
  assert.equal(state.mode, "playing");
  await callTestHook(desktop, "unlockBoss");
  await callTestHook(desktop, "setRadiusRatio", 0.2);
  state = await readState(desktop);
  assert.equal(state.goal.bossReady, true);
  assert.equal(state.goal.bossTarget.collectible, false);
  assert.equal(await callTestHook(desktop, "collectItem", boss.id), false);
  assert.equal((await readState(desktop)).mode, "playing");
  await callTestHook(desktop, "setRadiusRatio", (state.goal.bossTarget.requiredRadius * 1.02) / (state.player.radius / state.player.growthRatio));
  state = await readState(desktop);
  assert.equal(state.goal.bossTarget.collectible, true);
  assert.equal(await callTestHook(desktop, "collectItem", boss.id), true);
  state = await readState(desktop);
  assert.equal(state.mode, "eraClear");
  assert.equal(state.goal.bossTarget.collected, true);
  assert.ok(state.goal.collected >= state.goal.required);
  await desktop.screenshot({ path: new URL("desktop-era-clear.png", outputDir).pathname, fullPage: true });
  checks.push("boss stays locked until focus goal and adequate size, and is required for era clear");

  await callTestHook(desktop, "startEra", 0);
  const natural = await collectNaturalEraOneGrowth(desktop);
  state = natural.state;
  assert.deepEqual(natural.tiers.slice(0, 4), ["tiny", "small", "medium", "large"]);
  assert.ok(
    natural.tiers.includes("monument") || natural.tiers.at(-1) === "large",
    `expected natural growth through large or monument; tiers=${natural.tiers.join(" -> ")}`,
  );
  assert.ok(natural.collectedIds.length >= state.goal.required);
  assert.ok(natural.bossUnlockedAt !== null, "focus goal should naturally unlock boss");
  assert.equal(state.goal.bossReady, true);
  assert.equal(state.goal.bossTarget.collectible, true);
  assert.ok(state.player.radius >= state.goal.bossTarget.requiredRadius);
  assert.equal(await callTestHook(desktop, "collectItem", state.goal.bossTarget.id), true);
  state = await readState(desktop);
  assert.equal(state.mode, "eraClear");
  assert.equal(state.goal.bossTarget.collected, true);
  assert.ok(state.goal.collected >= state.goal.required);
  progress = await readProgress(desktop);
  assert.equal(progress.version, 2);
  assert.equal(progress.bestEra, 1);
  assert.equal(progress.eras["0"].completed, true);
  assert.equal(progress.eras["0"].bestScore, state.eraScore);
  assert.equal(progress.eras["0"].maxCombo, state.maxCombo);
  assert.match(progress.eras["0"].bestRank, /^[SAB]$/);
  assert.equal(progress.totalScore, progress.eras["0"].bestScore);
  observations.naturalEraOne = {
    tiers: natural.tiers,
    collectedIds: natural.collectedIds.length,
    bossUnlockedAt: natural.bossUnlockedAt,
    score: state.eraScore,
    maxCombo: state.maxCombo,
    bestRank: progress.eras["0"].bestRank,
  };
  checks.push(`natural era 1 growth ladder reaches boss threshold in ${natural.passes} passes`);

  await desktop.getByRole("button", { name: "다음 시대로" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 2);
  progress = await readProgress(desktop);
  assert.equal(progress.bestEra, 1);
  assert.equal(progress.eras["0"].completed, true);
  checks.push("v2 era clear records per-era bests and unlocks next era");

  await desktop.getByRole("button", { name: "게임 잠시 멈추기" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "paused");
  await desktop.getByRole("button", { name: "계속 굴리기" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  checks.push("pause and resume");

  await desktop.keyboard.down("ArrowRight");
  await desktop.evaluate(() => window.advanceTime?.(700));
  await desktop.keyboard.up("ArrowRight");
  state = await readState(desktop);
  assert.ok(state.player.x > 0.1);
  await desktop.keyboard.press("KeyR");
  state = await readState(desktop);
  assert.equal(state.era.index, 2);
  assert.equal(state.player.x, 0);
  assert.equal(state.player.z, 0);
  checks.push("movement and era retry");

  const eraLandmarkLabels = [
    "Era 1 Manufacturing",
    "Era 2 Construction",
    "Era 3 Transport",
    "Era 4 Communication",
    "Era 5 Life",
  ];
  const eraLandmarkCards = [];
  const eraLandmarkStates = [];
  for (let eraIndex = 0; eraIndex < 5; eraIndex += 1) {
    await callTestHook(desktop, "startEra", eraIndex);
    await callTestHook(desktop, "setCameraHeading", 0);
    state = await readState(desktop);
    assert.equal(state.era.index, eraIndex + 1);
    assert.ok(angleDistance(state.camera.heading, 0) <= 0.006);
    const screenshot = `era-landmark-${String(eraIndex + 1).padStart(2, "0")}.png`;
    const path = await captureCanvas(desktop, screenshot);
    eraLandmarkCards.push({ label: eraLandmarkLabels[eraIndex], path });
    eraLandmarkStates.push({
      label: eraLandmarkLabels[eraIndex],
      era: state.era,
      camera: state.camera,
      renderStats: state.renderStats,
      objectField: state.objectField,
      screenshot,
    });
  }
  const eraLandmarkDifferences = [];
  for (let index = 1; index < eraLandmarkCards.length; index += 1) {
    const difference = await imageDifference(eraLandmarkCards[index - 1].path, eraLandmarkCards[index].path);
    assert.ok(difference >= 2, `${eraLandmarkCards[index].label} should be visually distinct`);
    eraLandmarkDifferences.push({
      comparison: `${eraLandmarkCards[index - 1].label} vs ${eraLandmarkCards[index].label}`,
      meanAbsolutePixelDifference: difference,
    });
  }
  await buildContactSheet(eraLandmarkCards, "era-landmark-contact-sheet.png", 3, 480, 270);
  observations.eraLandmarkRegression = {
    eras: eraLandmarkStates,
    differences: eraLandmarkDifferences,
    contactSheet: "era-landmark-contact-sheet.png",
  };
  checks.push("all five era landmarks render as distinct non-blank scenes");

  const eraSetPieceCards = [];
  const eraSetPieceStates = [];
  const closeUpUiStyle = await desktop.addStyleTag({
    content: ".hud, .desktop-help, .touch-controls { visibility: hidden !important; }",
  });
  for (let eraIndex = 0; eraIndex < eraGeometry.length; eraIndex += 1) {
    const geometry = eraGeometry[eraIndex];
    const half = geometry.baseRadius * geometry.arenaUnits;
    const setPieceX = half * 0.31;
    const setPieceZ = -half * 0.42;
    const closeRadiusRatio = 0.3;
    const playerX = setPieceX;
    const playerZ = setPieceZ + geometry.baseRadius * 2.8;
    const setPieceTop = geometry.baseRadius * geometry.setPieceTopRatio;
    const framingTop = setPieceTop * (eraIndex === 2 ? 1 : 1.5);
    const cameraDistance = Math.max(geometry.baseRadius * 9.4, framingTop * 2.55);
    const cameraEye = [
      setPieceX,
      framingTop * 0.56 + geometry.baseRadius * 1.15,
      setPieceZ + cameraDistance,
    ];
    const cameraTarget = [setPieceX, framingTop * 0.52, setPieceZ];

    await callTestHook(desktop, "startEra", eraIndex);
    await callTestHook(desktop, "setRadiusRatio", closeRadiusRatio);
    await callTestHook(desktop, "setPlayerPosition", playerX, playerZ);
    await callTestHook(desktop, "setCameraPose", cameraEye, cameraTarget, 54);
    state = await readState(desktop);
    assert.equal(state.era.index, eraIndex + 1);
    assert.ok(angleDistance(state.camera.heading, 0) <= 0.006);
    assert.ok(Math.abs(state.player.x - playerX) <= 0.02);
    assert.ok(Math.abs(state.player.z - playerZ) <= 0.02);

    const screenshot = `era-setpiece-close-${String(eraIndex + 1).padStart(2, "0")}.png`;
    const path = await captureCanvas(desktop, screenshot);
    const projectedSpan = projectSetPieceVerticalSpan(
      state.camera,
      setPieceZ,
      geometry.baseRadius * geometry.setPieceTopRatio,
      720,
    );
    assert.ok(
      projectedSpan.visibleHeightPx >= 180,
      `${eraLandmarkLabels[eraIndex]} close set-piece should occupy at least 180px; actual=${projectedSpan.visibleHeightPx}`,
    );
    const vividMagentaPixels = await countVividMagentaPixels(path);
    assert.equal(
      vividMagentaPixels,
      0,
      `${eraLandmarkLabels[eraIndex]} close set-piece should not expose chroma-key magenta`,
    );
    eraSetPieceCards.push({ label: `${eraLandmarkLabels[eraIndex]} close`, path });
    eraSetPieceStates.push({
      label: eraLandmarkLabels[eraIndex],
      era: state.era,
      setPiece: {
        x: Number(setPieceX.toFixed(2)),
        z: Number(setPieceZ.toFixed(2)),
      },
      player: {
        x: state.player.x,
        z: state.player.z,
      },
      camera: state.camera,
      projectedSpan,
      vividMagentaPixels,
      screenshot,
    });
  }
  await closeUpUiStyle.evaluate((style) => style.remove());
  await buildContactSheet(
    eraSetPieceCards,
    "era-setpiece-close-contact-sheet.png",
    3,
    480,
    270,
  );
  observations.eraSetPieceCloseRegression = {
    eras: eraSetPieceStates,
    contactSheet: "era-setpiece-close-contact-sheet.png",
  };
  checks.push("all five era set-pieces render from deterministic front close-up positions");

  for (let eraIndex = 1; eraIndex < 5; eraIndex += 1) {
    await callTestHook(desktop, "startEra", eraIndex);
    state = await readState(desktop);
    assert.equal(state.era.index, eraIndex + 1);
    await callTestHook(desktop, "completeEra");
    state = await readState(desktop);
    assert.ok(state.goal.collected >= state.goal.required);
    assert.equal(state.goal.bossTarget.collected, true);
    if (eraIndex < 4) {
      assert.equal(state.mode, "eraClear");
    }
  }
  state = await readState(desktop);
  assert.equal(state.era.index, 5);
  assert.equal(state.mode, "victory");
  await desktop.screenshot({ path: new URL("desktop-victory.png", outputDir).pathname, fullPage: true });
  checks.push("all five eras and final future biodome victory");
  await desktop.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  trackErrors(mobile, "mobile");
  await mobile.goto(url, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("#start-btn");
  await mobile.screenshot({ path: new URL("mobile-intro.png", outputDir).pathname, fullPage: true });
  const layout = await mobile.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    startVisible: !!document.querySelector("#start-btn")?.getBoundingClientRect().height,
    touchDisplay: getComputedStyle(document.querySelector(".touch-controls")).display,
  }));
  assert.ok(layout.documentWidth <= layout.viewport + 1);
  assert.equal(layout.startVisible, true);
  assert.notEqual(layout.touchDisplay, "none");

  await mobile.click("#start-btn");
  await waitForVisualAssets(mobile);
  const beforeJoystick = await readState(mobile);
  observations.mobileRenderStats = beforeJoystick.renderStats;
  assert.ok(beforeJoystick.renderStats.drawCalls <= 180, `mobile drawCalls=${beforeJoystick.renderStats.drawCalls}`);
  assert.ok(
    beforeJoystick.renderStats.transparentCalls <= 35,
    `mobile transparentCalls=${beforeJoystick.renderStats.transparentCalls}`,
  );
  if (beforeJoystick.renderStats.frameMsP95 > 60) {
    checks.push(`mobile p95 recorded without hard cap: ${beforeJoystick.renderStats.frameMsP95}ms`);
  } else {
    checks.push(`mobile p95 within 60ms: ${beforeJoystick.renderStats.frameMsP95}ms`);
  }
  const joystick = mobile.locator(".joystick");
  const box = await joystick.boundingBox();
  assert.ok(box, "mobile joystick should have a bounding box");
  await mobile.mouse.move(box.x + box.width / 2, box.y + 8);
  await mobile.mouse.down();
  await mobile.evaluate(() => window.advanceTime?.(1800));
  await mobile.mouse.up();
  state = await readState(mobile);
  const moved = Math.hypot(state.player.x - beforeJoystick.player.x, state.player.z - beforeJoystick.player.z);
  assert.ok(moved > 0.1, `joystick should move player; moved=${moved}`);
  await mobile.screenshot({ path: new URL("mobile-playing.png", outputDir).pathname, fullPage: true });
  checks.push("mobile fit and pointer joystick movement");
  await mobile.close();
} finally {
  await browser.close();
}

assert.deepEqual(errors, [], `browser errors found:\n${errors.join("\n")}`);
const result = {
  passed: checks.length,
  checks,
  observations,
  errors,
  completedAt: new Date().toISOString(),
};
await writeFile(new URL("result.json", outputDir), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
