<?php
/**
 * request.php - tiny helper to read JSON request bodies.
 *
 * Purpose in plain words: when the Frontend sends
 *   fetch(url, {method:"POST", body: JSON.stringify({email, password})})
 * PHP does NOT put that into $_POST. This helper reads the raw body
 * and turns it into an array. Example:
 *   $data = json_body(); // ["email" => "a@b.com", "password" => "secret123"]
 * Returns [] when the body is empty or is not valid JSON.
 */
declare(strict_types=1);

function json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
