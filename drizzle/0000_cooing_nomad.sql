CREATE TABLE `leaderboard_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`nickname` text NOT NULL,
	`nickname_key` text NOT NULL,
	`collection_score` integer NOT NULL,
	`combo_bonus` integer NOT NULL,
	`time_bonus` integer NOT NULL,
	`clear_bonus` integer NOT NULL,
	`total_score` integer NOT NULL,
	`max_combo` integer NOT NULL,
	`started_era` integer NOT NULL,
	`reached_era` integer NOT NULL,
	`completed_eras` integer NOT NULL,
	`victory` integer NOT NULL,
	`score_version` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_scores_run_id_unique` ON `leaderboard_scores` (`run_id`);--> statement-breakpoint
CREATE INDEX `leaderboard_scores_rank_idx` ON `leaderboard_scores` (`completed_eras`,`total_score`,`max_combo`,`created_at`);--> statement-breakpoint
CREATE INDEX `leaderboard_scores_nickname_key_idx` ON `leaderboard_scores` (`nickname_key`);