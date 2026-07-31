import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const leaderboardScores = sqliteTable(
  "leaderboard_scores",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    nickname: text("nickname").notNull(),
    nicknameKey: text("nickname_key").notNull(),
    collectionScore: integer("collection_score").notNull(),
    comboBonus: integer("combo_bonus").notNull(),
    timeBonus: integer("time_bonus").notNull(),
    clearBonus: integer("clear_bonus").notNull(),
    totalScore: integer("total_score").notNull(),
    maxCombo: integer("max_combo").notNull(),
    startedEra: integer("started_era").notNull(),
    reachedEra: integer("reached_era").notNull(),
    completedEras: integer("completed_eras").notNull(),
    victory: integer("victory", { mode: "boolean" }).notNull(),
    scoreVersion: integer("score_version").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("leaderboard_scores_run_id_unique").on(table.runId),
    index("leaderboard_scores_rank_idx").on(
      table.completedEras,
      table.totalScore,
      table.maxCombo,
      table.createdAt
    ),
    index("leaderboard_scores_nickname_key_idx").on(table.nicknameKey),
  ]
);
