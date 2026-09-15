# selfhost/volumes/db

Init scripts mounted into the LOCAL `db` service (`--profile local-db`), vendored
verbatim from `github.com/supabase/supabase/docker/volumes/db/` (Apache-2.0) on
2026-09-15:

| file | mounted at | what it does |
|---|---|---|
| `roles.sql` | `init-scripts/99-roles.sql` | sets `POSTGRES_PASSWORD` on the service roles the image created |
| `jwt.sql` | `init-scripts/99-jwt.sql` | stores `JWT_SECRET`/`JWT_EXP` as database settings |
| `webhooks.sql` | `init-scripts/98-webhooks.sql` | `pg_net` + `supabase_functions` schema (Studio's webhooks page) |
| `realtime.sql` | `migrations/99-realtime.sql` | creates the `_realtime` schema Realtime keeps its tenant table in |

Not vendored: `_supabase.sql`, `logs.sql`, `pooler.sql` (the `_supabase` database
for Logflare and Supavisor — both services are dropped from this kit).

These run ONCE, when the data volume is first created. They are not used in
`DB_MODE=external`; `scripts/selfhost-bootstrap-db.sql` is the equivalent there.
