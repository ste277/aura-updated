\set exp_role 'aura_app_2026_11'
\set exp_owner 'neondb_owner'
\set exp_db 'neondb'
\set exp_vnum '170011'
\set exp_host_re '^ep-[a-z0-9-]+[.][a-z0-9.-]+[.]aws[.]neon[.]tech$'
\set exp_tables '{AuraMoment,AuthCode,Capture,CustomCity,DailyReflection,DayBuilderDismissal,Goal,GoalActivity,GoalActivityExecution,GoalActivityOccurrence,GuestConversionRedemption,Habit,HabitLog,PlanCreationIdempotency,PlannedActivity,ProductEvent,PushSubscription,ReminderAttention,ReminderDelivery,SavedPerson,User,UserActivityPreference,UserAvailabilityPeriod,VisitLog,_prisma_migrations}'
\set exp_enums '{PlannedActivitySchedulingMode}'
\set exp_defacl '{cloud_admin|public|S|neon_superuser|SELECT,cloud_admin|public|S|neon_superuser|UPDATE,cloud_admin|public|S|neon_superuser|USAGE,cloud_admin|public|r|neon_superuser|DELETE,cloud_admin|public|r|neon_superuser|INSERT,cloud_admin|public|r|neon_superuser|MAINTAIN,cloud_admin|public|r|neon_superuser|REFERENCES,cloud_admin|public|r|neon_superuser|SELECT,cloud_admin|public|r|neon_superuser|TRIGGER,cloud_admin|public|r|neon_superuser|TRUNCATE,cloud_admin|public|r|neon_superuser|UPDATE}'
\set ON_ERROR_ROLLBACK off
\set AUTOCOMMIT on
\set QUIET on
\pset pager off
\set QUIET off
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
SELECT set_config('b4.role', :'exp_role', false) AS r,
       set_config('b4.owner', :'exp_owner', false) AS o,
       set_config('b4.db', :'exp_db', false) AS d,
       set_config('b4.vnum', :'exp_vnum', false) AS v,
       set_config('b4.host', :'HOST', false) AS h,
       set_config('b4.host_re', :'exp_host_re', false) AS hr,
       set_config('b4.tables', :'exp_tables', false) AS t,
       set_config('b4.enums', :'exp_enums', false) AS e,
       set_config('b4.defacl', :'exp_defacl', false) AS a \gset b4cfg_
\echo 'B4 SETTINGS LOADED'
