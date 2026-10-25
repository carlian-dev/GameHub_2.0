<?php
/**
 * response.php - tiny helper to send JSON answers.
 *
 * Purpose in plain words:
 * Instead of writing header() + json_encode() in every file,
 * you just call one function. Example:
 *   json_response(["ok" => true, "db" => "gamehub_2_0"]); // HTTP 200
 *   json_response(["ok" => false, "error" => "Not found"], 404);
 *
 * It sets the HTTP status code, sets Content-Type to JSON,
 * prints the data nicely formatted, then stops the script.
 */
declare(strict_types=1);

function json_response(mixed $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

/**
 * api_abort - stop and report an API error with the right HTTP status.
 *
 * Purpose in plain words: instead of "return error array and hope the caller
 * checks it", you throw and public/index.php turns it into JSON.
 * Example: api_abort("email already used", 409);
 * Use 400 bad input, 401 not logged in, 403 not allowed, 404 missing,
 * 409 conflict (duplicate), 422 invalid data.
 */
function api_abort(string $message, int $code = 400): never
{
    throw new RuntimeException($message, $code);
}
