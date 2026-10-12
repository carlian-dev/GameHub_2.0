<?php
/**
 * src/function/tables/rates.php - Backend logic for hourly table rates (Sprint 02).
 *
 * Pair: rates card on Frontend/src/function/tables/tables.html <-> this file.
 * AD-016 regular rate, AD-017 special rate. Shape per type:
 * {type: regular|special, pricePerHour, active, updatedAt}.
 * Seeded defaults: regular ₱120/h, special ₱180/h (confirmed decisions).
 * When special rate conditions are decided (Q-001), selection rules attach here.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\UTCDateTime;

const RATE_TYPES = ['regular', 'special'];
const RATE_DEFAULTS = ['regular' => 120, 'special' => 180];

function rates_col()
{
    return DatabaseConnection::db()->selectCollection('rates');
}

function rates_seed(): void
{
    foreach (RATE_DEFAULTS as $type => $price) {
        rates_col()->updateOne(
            ['type' => $type],
            ['$setOnInsert' => [
                'type' => $type,
                'pricePerHour' => $price,
                'active' => true,
                'updatedAt' => new UTCDateTime(),
            ]],
            ['upsert' => true]
        );
    }
}

function rates_shape($doc): array
{
    return [
        'type' => $doc['type'] ?? '',
        'pricePerHour' => $doc['pricePerHour'] ?? 0,
        'active' => (bool)($doc['active'] ?? true),
    ];
}

/** AD-016 + AD-017: view current rates (admin-only for now). */
function rates_list(array $params = []): array
{
    require_admin();
    rates_seed();
    $out = [];
    foreach (rates_col()->find([]) as $doc) {
        $out[] = rates_shape($doc);
    }
    return ['ok' => true, 'rates' => $out];
}

/** AD-016 + AD-017: set a rate (type regular|special, positive price). */
function rates_set(array $params = []): array
{
    require_admin();
    $data = json_body();
    $type = strtolower(trim((string)($data['type'] ?? '')));
    $price = $data['pricePerHour'] ?? null;
    if (!in_array($type, RATE_TYPES, true)) {
        api_abort('type must be regular or special', 422);
    }
    if (!is_numeric($price) || $price <= 0) {
        api_abort('pricePerHour must be a positive number', 422);
    }
    rates_col()->updateOne(
        ['type' => $type],
        ['$set' => ['pricePerHour' => (float)$price, 'active' => true, 'updatedAt' => new UTCDateTime()]],
        ['upsert' => true]
    );
    return ['ok' => true, 'rate' => rates_shape(rates_col()->findOne(['type' => $type]))];
}