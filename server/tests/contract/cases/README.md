# Contract cases

One `.json` file per case, one or more cases per route (40 routes total).
Fields:

- `id`: unique case id, e.g. `auth.login.happy`
- `route`: human-readable label, e.g. `POST /api/login`
- `method`: GET | POST | PUT | DELETE | OPTIONS
- `path`: URL path, `{id}`/`{token}`/`{ref}` placeholders replaced with a real value
- `query`: optional query object
- `headers`: optional extra headers
- `body`: optional request body (JSON)
- `expect.status`: expected HTTP status
- `expect.body`: expected JSON body (dynamic fields are normalized to `<dyn>`)
- `expect.headers`: optional expected headers

Dynamic fields normalized before diff (see `normalize.js`):
`id`, `sessionId`, `tableId`, `ref`, `token`, `link`, `createdAt`,
`updatedAt`, `startTime`, `endTime`, `closedAt`, `paidAt`.

The runner guards: refuses to run unless `MONGODB_DB` ends with `_migtest`.
Known divergence allowlist: only migration.md §14.
