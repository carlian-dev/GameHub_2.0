<?php
/**
 * Backend/scripts/setup_transactions_indexes.php - one-time Sprint 3 setup.
 *
 * Creates: unique `ref`, unique `sessionId`, compound {paidAt:1, method:1}
 * on `transactions`. Run once from Backend/: `php scripts/setup_transactions_indexes.php`.
 * Never called per-request (per AGENTS.md).
 */
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Dotenv\Dotenv;
use App\Config\DatabaseConnection;

$dotenv = Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->safeLoad();

$col = DatabaseConnection::db()->selectCollection('transactions');
$made = [];
$made[] = $col->createIndex(['ref' => 1], ['unique' => true, 'name' => 'uniq_ref']);
$made[] = $col->createIndex(['sessionId' => 1], ['unique' => true, 'name' => 'uniq_sessionId']);
$made[] = $col->createIndex(['paidAt' => 1, 'method' => 1], ['name' => 'paidAt_method']);
echo "transactions indexes OK: " . implode(', ', $made) . PHP_EOL;
