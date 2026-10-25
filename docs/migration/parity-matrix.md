# Parity Matrix — GameHub_2.0 PHP → Node Migration

All 40 API routes from `Backend/routes/api.php` mapped to Node implementation status.
Test IDs map to `server/tests/contract/cases/*.json`.

Access legend: **Public** = no login; **Auth** = any active logged-in user; **Admin** = admin only.

| # | Method | Path | Access | PHP handler | Node target | PHP tested | Node implemented | Parity green | Notes |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/health` | Public | `health_handle` | `health.controller` | ⬜ | ✅ | ⬜ | |
| 2 | GET | `/api/config` | Public | `app_config` | `settings.controller` | ⬜ | ✅ | ⬜ | |
| 3 | POST | `/api/cashiers/register` | Public | `auth_register` | `auth.controller` | ⬜ | ✅ | ⬜ | |
| 4 | GET | `/api/invitations/{token}` | Public | `invite_check` | `invitation.controller` | ⬜ | ✅ | ⬜ | |
| 5 | POST | `/api/login` | Public | `auth_login` | `auth.controller` | ⬜ | ✅ | ⬜ | |
| 6 | POST | `/api/auth/google` | Public | `google_login` | `auth.controller` | ⬜ | ⚠️ | ⬜ | Stub returns 503; tokeninfo verification not yet implemented |
| 7 | POST | `/api/logout` | Auth | `auth_logout` | `auth.controller` | ⬜ | ✅ | ⬜ | |
| 8 | GET | `/api/me` | Auth | `auth_me` | `auth.controller` | ⬜ | ✅ | ⬜ | |
| 9 | POST | `/api/admin/invitations` | Admin | `invite_create` | `invitation.controller` | ⬜ | ✅ | ⬜ | |
| 10 | GET | `/api/admin/invitations` | Admin | `invite_list` | `invitation.controller` | ⬜ | ✅ | ⬜ | |
| 11 | POST | `/api/admin/invitations/{id}/revoke` | Admin | `invite_revoke` | `invitation.controller` | ⬜ | ✅ | ⬜ | |
| 12 | GET | `/api/admin/settings/integrations` | Admin | `settings_list` | `settings.controller` | ⬜ | ✅ | ⬜ | |
| 13 | PUT | `/api/admin/settings/integrations/{key}` | Admin | `settings_update` | `settings.controller` | ⬜ | ✅ | ⬜ | Transaction + audit |
| 14 | GET | `/api/admin/cashiers` | Admin | `cashiers_list` | `cashierAdmin.controller` | ⬜ | ✅ | ⬜ | |
| 15 | PUT | `/api/admin/cashiers/{id}` | Admin | `cashiers_update` | `cashierAdmin.controller` | ⬜ | ✅ | ⬜ | |
| 16 | POST | `/api/admin/cashiers/{id}/archive` | Admin | `cashiers_archive` | `cashierAdmin.controller` | ⬜ | ✅ | ⬜ | |
| 17 | POST | `/api/admin/cashiers/{id}/unarchive` | Admin | `cashiers_unarchive` | `cashierAdmin.controller` | ⬜ | ✅ | ⬜ | |
| 18 | GET | `/api/admin/tables` | Admin | `tables_list` | `table.controller` | ⬜ | ✅ | ⬜ | |
| 19 | POST | `/api/admin/tables` | Admin | `tables_add` | `table.controller` | ⬜ | ✅ | ⬜ | |
| 20 | PUT | `/api/admin/tables/{id}` | Admin | `tables_rename` | `table.controller` | ⬜ | ✅ | ⬜ | |
| 21 | PUT | `/api/admin/tables/{id}/status` | Admin | `tables_status` | `table.controller` | ⬜ | ✅ | ⬜ | |
| 22 | POST | `/api/admin/tables/{id}/archive` | Admin | `tables_archive` | `table.controller` | ⬜ | ✅ | ⬜ | |
| 23 | POST | `/api/admin/tables/{id}/unarchive` | Admin | `tables_unarchive` | `table.controller` | ⬜ | ✅ | ⬜ | |
| 24 | GET | `/api/admin/rates` | Admin | `rates_list` | `rate.controller` | ⬜ | ✅ | ⬜ | |
| 25 | PUT | `/api/admin/rates` | Admin | `rates_set` | `rate.controller` | ⬜ | ✅ | ⬜ | |
| 26 | GET | `/api/admin/sessions` | Admin | `sessions_list` | `session.controller` | ⬜ | ✅ | ⬜ | |
| 27 | GET | `/api/cashier/sessions` | Auth | `sessions_cashier_list` | `session.controller` | ⬜ | ✅ | ⬜ | |
| 28 | POST | `/api/cashier/sessions` | Auth | `sessions_start` | `session.controller` | ⬜ | ✅ | ⬜ | |
| 29 | POST | `/api/cashier/sessions/{id}/extend` | Auth | `sessions_extend` | `session.controller` | ⬜ | ✅ | ⬜ | |
| 30 | POST | `/api/cashier/sessions/{id}/end` | Auth | `sessions_end` | `session.controller` | ⬜ | ✅ | ⬜ | Returns `{ok, amount, billedHours, session}` |
| 31 | POST | `/api/cashier/sessions/{id}/cancel` | Auth | `sessions_cancel` | `session.controller` | ⬜ | ✅ | ⬜ | |
| 32 | GET | `/api/cashier/tables` | Auth | `tables_cashier_list` | `table.controller` | ⬜ | ✅ | ⬜ | Excludes archived |
| 33 | GET | `/api/tables/availability` | Public | `tables_public_list` | `table.controller` | ⬜ | ✅ | ⬜ | Available + non-archived only |
| 34 | POST | `/api/cashier/transactions` | Auth | `transactions_create` | `transaction.controller` | ⬜ | ✅ | ⬜ | Double-bill 409, short-payment 422 |
| 35 | GET | `/api/cashier/transactions` | Auth | `transactions_cashier_list` | `transaction.controller` | ⬜ | ✅ | ⬜ | Limit 200 |
| 36 | GET | `/api/cashier/transactions/{ref}` | Auth | `transactions_cashier_get` | `transaction.controller` | ⬜ | ✅ | ⬜ | |
| 37 | GET | `/api/admin/transactions` | Admin | `transactions_admin_list` | `transaction.controller` | ⬜ | ✅ | ⬜ | Limit 500 |
| 38 | GET | `/api/admin/transactions/{ref}` | Admin | `transactions_admin_get` | `transaction.controller` | ⬜ | ✅ | ⬜ | |
| 39 | GET | `/api/admin/reports/daily` | Admin | `reports_daily` | `report.controller` | ⬜ | ✅ | ⬜ | |
| 40 | GET | `/api/admin/reports/export` | Admin | `reports_export` | `report.controller` | ⬜ | ✅ | ⬜ | CSV, text/csv |

## Legend

- **PHP tested**: ✅ PHP handler verified against real DB / ⬜ not yet (Atlas unreachable)
- **Node implemented**: ✅ Node handler written / ⚠️ stub / ⬜ not written
- **Parity green**: ✅ Node output matches PHP golden / ⬜ pending PHP goldens

## Approved divergences (§14)

| # | Divergence | Routes affected |
|---|---|---|
| 1 | `req.session.regenerate()` + `save()` on login | 5, 6 |
| 2 | Unexpected 500s return `"internal server error"` | All |
| 3 | `GET /api/me` status re-check destroys session | 8 |
| 4 | Duplicate key `11000` maps to 409 | 19, 20, 34 |
| 5 | `withTransaction()` retries transient errors | 13 |
| 6 | Root `GET /` service string says Node | (probe only) |
| 7 | Session idle lifetime 12h rolling | All (session) |
| 8 | Explicit cookie flags | All (session) |
| 9 | ETag disabled | All |

## PHP goldens status

⬜ Not captured — Atlas unreachable from this environment (TLS handshake alert / IP allowlist). Goldens must be captured on a network that can reach `gamehub_2_0` before parity diff can run.
