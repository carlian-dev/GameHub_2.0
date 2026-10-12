<?php
/**
 * src/function/tables/tables.php - Backend logic for billiard tables (Sprint 02).
 *
 * Pair: Frontend/src/function/tables/tables.html <-> this file.
 * AD-009 add, AD-010 rename, AD-011 archive, AD-008 unarchive,
 * AD-012 maintenance status, AD-013 status filter view.
 * Shape: {name unique, status: available|occupied|reserved|maintenance,
 * archived: bool, createdAt}. Archived tables are hidden from play flows
 * (same convention as archived cashiers). Mutations are admin-only;
 * the filtered list is admin-only for now (cashier/public views later).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

const TABLE_STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];

function tables_col()
{
    $col = DatabaseConnection::db()->selectCollection('tables');
    try {
        $col->createIndex(['name' => 1], ['unique' => true]);
    } catch (Throwable $ignored) {
    }
    return $col;
}

function tables_id(string $raw): ObjectId
{
    if (!preg_match('#^[0-9a-fA-F]{24}$#', $raw)) {
        api_abort('invalid id', 422);
    }
    return new ObjectId($raw);
}

function tables_shape($doc): array
{
    return [
        'id' => (string)$doc['_id'],
        'name' => $doc['name'] ?? '',
        'status' => $doc['status'] ?? 'available',
        'archived' => (bool)($doc['archived'] ?? false),
        'createdAt' => isset($doc['createdAt'])
            ? $doc['createdAt']->toDateTime()->format(DATE_ATOM) : null,
    ];
}

/** AD-013: list tables, optional ?status=available|occupied|reserved|maintenance|archived|all. */
function tables_list(array $params = []): array
{
    require_admin();
    $status = strtolower(trim((string)($_GET['status'] ?? 'all')));
    $filter = [];
    if ($status === 'archived') {
        $filter['archived'] = true;
    } elseif (in_array($status, TABLE_STATUSES, true)) {
        $filter = ['status' => $status, 'archived' => ['$ne' => true]];
    }
    $cursor = tables_col()->find($filter, ['sort' => ['name' => 1]]);
    $out = [];
    foreach ($cursor as $doc) {
        $out[] = tables_shape($doc);
    }
    return ['ok' => true, 'tables' => $out];
}

/** AD-009: add a billiard table (starts available, unarchived). */
function tables_add(array $params = []): array
{
    require_admin();
    $data = json_body();
    $name = trim((string)($data['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 60) {
        api_abort('table name is required (max 60 chars)', 422);
    }
    if (tables_col()->findOne(['name' => $name]) !== null) {
        api_abort('table name already used', 409);
    }
    $res = tables_col()->insertOne([
        'name' => $name,
        'status' => 'available',
        'archived' => false,
        'createdAt' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'table' => tables_shape(tables_col()->findOne(['_id' => $res->getInsertedId()]))];
}

/** AD-010: rename a billiard table. */
function tables_rename(array $params = []): array
{
    require_admin();
    $data = json_body();
    $name = trim((string)($data['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 60) {
        api_abort('table name is required (max 60 chars)', 422);
    }
    $id = tables_id($params['id'] ?? '');
    $doc = tables_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('table not found', 404);
    }
    $dup = tables_col()->findOne(['name' => $name, '_id' => ['$ne' => $id]]);
    if ($dup !== null) {
        api_abort('table name already used', 409);
    }
    tables_col()->updateOne(['_id' => $id], ['$set' => ['name' => $name]]);
    return ['ok' => true, 'table' => tables_shape(tables_col()->findOne(['_id' => $id]))];
}

/** AD-012: set status available|occupied|reserved|maintenance (never archived ones). */
function tables_status(array $params = []): array
{
    require_admin();
    $data = json_body();
    $status = strtolower(trim((string)($data['status'] ?? '')));
    if (!in_array($status, TABLE_STATUSES, true)) {
        api_abort('status must be available, occupied, reserved, or maintenance', 422);
    }
    $id = tables_id($params['id'] ?? '');
    $doc = tables_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('table not found', 404);
    }
    if (!empty($doc['archived'])) {
        api_abort('archived tables cannot change status — unarchive first', 422);
    }
    tables_col()->updateOne(['_id' => $id], ['$set' => ['status' => $status]]);
    return ['ok' => true, 'table' => tables_shape(tables_col()->findOne(['_id' => $id]))];
}

/** AD-011: archive a billiard table (hidden from play flows, history kept). */
function tables_archive(array $params = []): array
{
    require_admin();
    $id = tables_id($params['id'] ?? '');
    $doc = tables_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('table not found', 404);
    }
    tables_col()->updateOne(['_id' => $id], ['$set' => ['archived' => true]]);
    return ['ok' => true, 'id' => (string)$doc['_id'], 'archived' => true];
}

/** CU-002: public availability feed (no login). Available + non-archived only. */
function tables_public_list(array $params = []): array
{
    $out = [];
    $cursor = tables_col()->find(
        ['status' => 'available', 'archived' => ['$ne' => true]],
        ['sort' => ['name' => 1]]
    );
    foreach ($cursor as $doc) {
        $out[] = [
            'id' => (string)$doc['_id'],
            'name' => $doc['name'] ?? '',
            'status' => $doc['status'] ?? 'available',
        ];
    }
    return ['ok' => true, 'tables' => $out];
}

/** AD-008: unarchive a billiard table (back to available). */
function tables_unarchive(array $params = []): array
{
    require_admin();
    $id = tables_id($params['id'] ?? '');
    $doc = tables_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('table not found', 404);
    }
    if (empty($doc['archived'])) {
        api_abort('only archived tables can be unarchived', 422);
    }
    tables_col()->updateOne(
        ['_id' => $id],
        ['$set' => ['archived' => false, 'status' => 'available']]
    );
    return ['ok' => true, 'table' => tables_shape(tables_col()->findOne(['_id' => $id]))];
}