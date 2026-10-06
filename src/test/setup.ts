import "dotenv/config"

// Tests run against the separate test database (see docs/DEVELOPMENT.md).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://lart:lart@127.0.0.1:5432/lart_test"
process.env.APP_URL ??= "http://localhost:3000"
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64")
