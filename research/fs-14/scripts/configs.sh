# One line per config: name | runtime | server file | port | extra environment
# Drizzle servers listen on 3000, Kysely servers on 3004 (hard-coded in the harness).
CONFIGS=(
  "drizzle-node24-pg|node|src/drizzle-server-node.ts|3000|DRIVER=pg"
  "drizzle-node24-drizzle|node|src/drizzle-server-node.ts|3000|DRIVER=drizzle"
  "drizzle-node24-drizzle-nopipe|node|src/drizzle-server-node.ts|3000|DRIVER=drizzle PIPELINE=off"
  "drizzle-bun14-bunsql|bun|src/drizzle-server-bun.ts|3000|DRIVER=bun"
  "drizzle-bun14-drizzle|bun|src/drizzle-server-bun.ts|3000|DRIVER=drizzle"
  "kysely-node24-pg|node|src/kysely-server-node.ts|3004|DRIVER=pg"
  "kysely-node24-postgresjs|node|src/kysely-server-node.ts|3004|DRIVER=postgresjs"
  "kysely-node24-drizzle|node|src/kysely-server-node.ts|3004|DRIVER=drizzle"
)
