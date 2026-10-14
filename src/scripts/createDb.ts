import "dotenv/config";
import pg from "pg";
import { config } from "../config";

/** Creates the database named in DATABASE_URL if it doesn't exist (connects via the `postgres` db). */
async function main() {
  const url = new URL(config.databaseUrl);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Unexpected database name: ${dbName}`);
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rowCount) console.log(`database ${dbName} already exists`);
    else {
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`created database ${dbName}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
