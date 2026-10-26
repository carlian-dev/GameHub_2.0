<?php
/**
 * DatabaseConnection - the ONLY place that talks to MongoDB Atlas.
 *
 * Purpose in plain words:
 * Instead of every file opening its own connection to Atlas
 * (slow and wasteful), this file opens ONE shared connection and
 * lets everyone reuse it. Like having one phone line to Atlas
 * that the whole Backend shares.
 *
 * How to use it (example in a Controller):
 *   $db = DatabaseConnection::db(); // gives you gamehub_2_0
 *   $count = $db->selectCollection('users')->countDocuments();
 *
 * Methods:
 * - client() : creates the MongoDB\Client once from MONGODB_URI.
 * - dbName() : reads MONGODB_DB from .env, e.g. "gamehub_2_0".
 * - db()     : returns the selected database object.
 * - ping()   : sends {ping:1} to Atlas to test "are you alive?".
 */
declare(strict_types=1);

namespace App\Config;

use MongoDB\Client;
use MongoDB\Database;

final class DatabaseConnection
{
    private static ?Client $client = null;

    public static function client(): Client
    {
        if (self::$client === null) {
            $uri = $_ENV['MONGODB_URI'] ?? getenv('MONGODB_URI') ?: '';
            if ($uri === '') {
                throw new \RuntimeException('MONGODB_URI is not set in .env');
            }
            self::$client = new Client($uri, [
                'serverSelectionTimeoutMS' => 10000,
                'connectTimeoutMS' => 10000,
                'socketTimeoutMS' => 30000,
                'retryWrites' => true,
                'retryReads' => true,
            ]);
        }
        return self::$client;
    }

    public static function dbName(): string
    {
        return $_ENV['MONGODB_DB'] ?? getenv('MONGODB_DB') ?: 'gamehub_2_0';
    }

    public static function db(): Database
    {
        return self::client()->selectDatabase(self::dbName());
    }

    public static function ping(): bool
    {
        $result = self::db()->command(['ping' => 1])->toArray();
        return isset($result[0]) && (array)$result[0] === ['ok' => 1.0] || (string)json_encode($result[0]) !== '';
    }
}
