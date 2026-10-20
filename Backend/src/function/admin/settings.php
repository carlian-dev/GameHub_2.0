<?php
/**
 * src/function/admin/settings.php - admin-only integration settings.
 *
 * Owns the server-side integration registry, MongoDB-backed integration
 * documents, masked credential shapes, the public /api/config projection, and
 * the admin list endpoint. Credential values are never returned in full:
 * admin responses expose only a mask and a boolean "configured" flag.
 *
 * Storage: `settings` collection, one document per registry key. The database
 * is the source of truth once a document exists; environment values are used
 * only as a default when the document is missing. Index creation and seeding
 * live in Backend/scripts/setup_settings.php (never per request).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

function settings_collection(): \MongoDB\Collection
{
    return DatabaseConnection::db()->selectCollection('settings');
}

/** Server-defined integrations. Drives both the admin cards and enforcement. */
function settings_registry(): array
{
    return [
        'googleAuth' => [
            'name' => 'Google Authentication',
            'description' => 'Admin Google sign-in',
            'available' => true,
            'credentials' => [
                'clientId' => [
                    'label' => 'OAuth Client ID',
                    'required' => true,
                    'secret' => false,
                ],
            ],
        ],
        'googleMaps' => [
            'name' => 'Google Maps',
            'description' => 'Location map on the public landing page',
            'available' => true,
            'credentials' => [
                'apiKey' => [
                    'label' => 'Maps API key (optional)',
                    'required' => false,
                    'secret' => false,
                ],
            ],
        ],
        'recaptcha' => [
            'name' => 'reCAPTCHA',
            'description' => 'Bot protection (planned)',
            'available' => false,
            'credentials' => [
                'siteKey' => ['label' => 'Site key', 'required' => false, 'secret' => false],
                'secretKey' => ['label' => 'Secret key', 'required' => false, 'secret' => true],
            ],
        ],
        'otp' => [
            'name' => 'OTP / email codes',
            'description' => 'Email verification codes (planned)',
            'available' => false,
            'credentials' => [],
        ],
    ];
}

/** Recursively turn BSON documents/arrays into plain PHP arrays. */
function settings_normalize(mixed $value): mixed
{
    if ($value instanceof UTCDateTime || $value instanceof ObjectId) {
        return $value;
    }
    if ($value instanceof \MongoDB\BSON\Document) {
        $value = $value->toPHP();
        if (is_array($value) && count($value) === 1 && array_key_exists('root', $value)) {
            $value = $value['root'];
        }
    } elseif ($value instanceof \Traversable) {
        $value = iterator_to_array($value);
    } elseif (is_object($value)) {
        $value = (array)$value;
    }
    if (is_array($value)) {
        foreach ($value as $k => $v) {
            $value[$k] = settings_normalize($v);
        }
    }
    return $value;
}

/**
 * Default effective settings when no document exists. Google Auth falls back
 * to GOOGLE_CLIENT_ID; Maps preserves the legacy landing-page map.
 */
function settings_default(string $key): array
{
    $registry = settings_registry();
    $credentials = [];
    foreach (($registry[$key]['credentials'] ?? []) as $name => $def) {
        $credentials[$name] = ['value' => '', 'last4' => '', 'updatedAt' => null];
    }
    $enabled = false;
    if ($key === 'googleAuth') {
        $clientId = trim((string)($_ENV['GOOGLE_CLIENT_ID'] ?? getenv('GOOGLE_CLIENT_ID') ?: ''));
        if ($clientId !== '') {
            $enabled = true;
            $credentials['clientId'] = [
                'value' => $clientId,
                'last4' => substr($clientId, -4),
                'updatedAt' => null,
            ];
        }
    } elseif ($key === 'googleMaps') {
        // Legacy default: the keyless embed is shown when nothing is configured.
        $enabled = true;
    }
    return [
        'key' => $key,
        'enabled' => $enabled,
        'credentials' => $credentials,
        'updatedAt' => null,
        'updatedBy' => null,
    ];
}

/** Raw settings document, or null when the key is not seeded. Throws on DB failure. */
function settings_document(string $key): ?array
{
    $doc = settings_collection()->findOne(['key' => $key]);
    if ($doc === null) {
        return null;
    }
    $normalized = settings_normalize($doc);
    return is_array($normalized) ? $normalized : null;
}

/** Effective settings: database document when present, defaults otherwise. */
function settings_effective(string $key): array
{
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }
    $doc = settings_document($key);
    $basis = $doc ?? settings_default($key);

    $credentials = [];
    $rawCredentials = is_array($basis['credentials'] ?? null) ? $basis['credentials'] : [];
    foreach ($registry[$key]['credentials'] as $name => $def) {
        $raw = is_array($rawCredentials[$name] ?? null) ? $rawCredentials[$name] : [];
        $value = (string)($raw['value'] ?? '');
        $last4 = (string)($raw['last4'] ?? '');
        if ($last4 === '' && $value !== '') {
            $last4 = substr($value, -4);
        }
        $updatedAt = $raw['updatedAt'] ?? null;
        $credentials[$name] = [
            'value' => $value,
            'last4' => $last4,
            'updatedAt' => $updatedAt instanceof UTCDateTime ? $updatedAt : null,
        ];
    }

    $enabled = (bool)($basis['enabled'] ?? false);
    // A required credential is a hard prerequisite, even for legacy documents.
    foreach ($registry[$key]['credentials'] as $name => $def) {
        if (!empty($def['required']) && $credentials[$name]['value'] === '') {
            $enabled = false;
        }
    }

    return [
        'key' => $key,
        'enabled' => $enabled,
        'credentials' => $credentials,
        'updatedAt' => ($basis['updatedAt'] ?? null) instanceof UTCDateTime
            ? $basis['updatedAt'] : null,
        'updatedBy' => isset($basis['updatedBy']) ? (string)$basis['updatedBy'] : null,
    ];
}

/** Eight bullets plus the last four characters; bullets only for short values. */
function settings_mask_value(string $value): string
{
    if ($value === '') {
        return '';
    }
    if (strlen($value) > 8) {
        return str_repeat('•', 8) . substr($value, -4);
    }
    return str_repeat('•', 8);
}

/** Safe admin shape for one integration: masked credentials only. */
function settings_shape(string $key, array $doc): array
{
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }
    $credentials = [];
    foreach ($registry[$key]['credentials'] as $name => $def) {
        $value = (string)($doc['credentials'][$name]['value'] ?? '');
        $credentials[] = [
            'name' => $name,
            'label' => $def['label'],
            'required' => (bool)$def['required'],
            'configured' => $value !== '',
            'masked' => settings_mask_value($value),
        ];
    }
    $updatedAt = $doc['updatedAt'] ?? null;
    return [
        'key' => $key,
        'name' => $registry[$key]['name'],
        'description' => $registry[$key]['description'],
        'available' => (bool)$registry[$key]['available'],
        'enabled' => (bool)($doc['enabled'] ?? false),
        'credentials' => $credentials,
        'updatedAt' => $updatedAt instanceof UTCDateTime
            ? $updatedAt->toDateTime()->format(DATE_ATOM) : null,
        'updatedBy' => isset($doc['updatedBy']) ? (string)$doc['updatedBy'] : null,
    ];
}

/** Public integration state for GET /api/config (never includes secrets). */
function settings_public_config(): array
{
    $auth = settings_effective('googleAuth');
    $maps = settings_effective('googleMaps');
    return [
        'googleAuth' => [
            'enabled' => (bool)$auth['enabled'],
            'clientId' => $auth['enabled'] ? (string)$auth['credentials']['clientId']['value'] : '',
        ],
        'googleMaps' => [
            'enabled' => (bool)$maps['enabled'],
            'apiKey' => $maps['enabled'] ? (string)$maps['credentials']['apiKey']['value'] : '',
        ],
    ];
}

/** Google Auth state for backend enforcement. Throws when the store fails. */
function settings_google_auth(): array
{
    $auth = settings_effective('googleAuth');
    return [
        'enabled' => (bool)$auth['enabled'],
        'clientId' => (string)$auth['credentials']['clientId']['value'],
    ];
}

/** GET /api/config - public feature state. Fail closed on a store failure. */
function app_config(array $params = []): array
{
    header('Cache-Control: no-store');
    try {
        $integrations = settings_public_config();
    } catch (Throwable $e) {
        error_log('[gamehub] settings config read failed');
        $clientId = trim((string)($_ENV['GOOGLE_CLIENT_ID'] ?? getenv('GOOGLE_CLIENT_ID') ?: ''));
        $integrations = [
            'googleAuth' => [
                'enabled' => $clientId !== '',
                'clientId' => $clientId,
            ],
            'googleMaps' => ['enabled' => false, 'apiKey' => ''],
        ];
    }
    return [
        'ok' => true,
        // Temporary compatibility key for the current login.js (removed in Task 4).
        'googleClientId' => $integrations['googleAuth']['clientId'],
        'integrations' => $integrations,
    ];
}

/** GET /api/admin/settings/integrations - admin-only, masked credentials. */
function settings_list(array $params = []): array
{
    require_admin();
    $out = [];
    foreach (array_keys(settings_registry()) as $key) {
        $out[] = settings_shape($key, settings_effective($key));
    }
    return ['ok' => true, 'integrations' => $out];
}
