import assert from "node:assert/strict";
import test from "node:test";

import type * as StoryModule from "../app/timeRollStory";

const storyUrl = new URL("../app/timeRollStory.ts", import.meta.url);
const story = await import(storyUrl.href) as typeof StoryModule;

const EXPECTED_THEMES: readonly StoryModule.TimeRollThemeId[] = [
  "manufacturing",
  "construction",
  "transport",
  "communication",
  "life",
];

const MAX_UI_LINE_LENGTH = 34;

function collectUiLines() {
  return [
    story.TIME_ROLL_PROTAGONIST.name,
    story.TIME_ROLL_PROTAGONIST.role,
    story.TIME_ROLL_PROTAGONIST.callout,
    story.TIME_ROLL_WORLD_PREMISE.title,
    ...story.TIME_ROLL_WORLD_PREMISE.lines,
    story.TIME_ROLL_INTRO_TEASER.kicker,
    ...story.TIME_ROLL_INTRO_TEASER.title,
    story.TIME_ROLL_INTRO_TEASER.tagline,
    story.TIME_ROLL_INTRO_TEASER.tip,
    ...story.TIME_ROLL_ERA_STORIES.flatMap((era) => [
      era.themeLabel,
      era.eraName,
      era.missionTitle,
      ...era.missionBriefing,
      era.bossLabel,
      era.bossWarning,
      era.clearTitle,
      ...era.clearLines,
    ]),
    story.TIME_ROLL_ENDING.eyebrow,
    story.TIME_ROLL_ENDING.title,
    ...story.TIME_ROLL_ENDING.lines,
  ];
}

test("story system covers the robot protagonist and five era themes", () => {
  assert.equal(story.TIME_ROLL_PROTAGONIST.id, "tori");
  assert.match(story.TIME_ROLL_PROTAGONIST.name, /로봇/);
  assert.equal(story.TIME_ROLL_ERA_STORIES.length, 5);
  assert.deepEqual(story.TIME_ROLL_ERA_STORIES.map((era) => era.id), EXPECTED_THEMES);
  assert.deepEqual(story.TIME_ROLL_ERA_STORIES.map((era) => era.order), [1, 2, 3, 4, 5]);
});

test("boss labels match the per-era story labels", () => {
  for (const era of story.TIME_ROLL_ERA_STORIES) {
    assert.equal(story.TIME_ROLL_BOSS_LABELS[era.id], era.bossLabel);
    assert.equal(story.getTimeRollEraStory(era.id), era);
  }
});

test("all UI lines remain compact", () => {
  for (const line of collectUiLines()) {
    assert.ok(
      line.length <= MAX_UI_LINE_LENGTH,
      `${line} is ${line.length} chars, expected <= ${MAX_UI_LINE_LENGTH}`,
    );
  }
});
