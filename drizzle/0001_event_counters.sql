CREATE TABLE "event_counters" (
	"day" date NOT NULL,
	"outcome" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_counters_day_outcome_pk" PRIMARY KEY("day","outcome"),
	CONSTRAINT "event_counters_outcome_check" CHECK ("event_counters"."outcome" in ('delivered', 'failed', 'dropped'))
);
