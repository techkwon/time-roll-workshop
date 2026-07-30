import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const url = process.env.GAME_URL || "http://localhost:3000";
const saveKey = "time-roll-workshop-v1";
const outputDir = new URL("../output/e2e/", import.meta.url);
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
  let state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 1);
  assert.equal(state.player.growthTier, "tiny");
  assert.ok(state.player.growthRatio < 0.2);
  await desktop.screenshot({ path: new URL("desktop-playing-start.png", outputDir).pathname, fullPage: true });

  const oversized = findOversizedItem(state);
  assert.equal(await callTestHook(desktop, "warpToItem", oversized.id), true);
  assert.equal(await callTestHook(desktop, "collectItem", oversized.id), false);
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.lastCollection, "");
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
