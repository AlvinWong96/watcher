<?php
declare(strict_types=1);
ob_start();
ini_set('display_errors', '0');
ini_set('log_errors', '1');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    ob_end_clean();
    echo json_encode(['error' => 'POST required']);
    exit;
}

$body = file_get_contents('php://input');
$data = json_decode($body, true);

$message = trim($data['message'] ?? '');
$model   = trim($data['model']   ?? 'llama3.2:3b');
$history = $data['history']      ?? [];

if (empty($message)) {
    http_response_code(400);
    ob_end_clean();
    echo json_encode(['error' => 'message is required']);
    exit;
}

// Sanitise model name — only allow alphanumeric, colon, dot, hyphen
if (!preg_match('/^[a-zA-Z0-9:\.\-]+$/', $model)) {
    http_response_code(400);
    ob_end_clean();
    echo json_encode(['error' => 'Invalid model name']);
    exit;
}

// Build message history (system + prior turns + new user message)
$messages = [
    ['role' => 'system', 'content' => 'You are a helpful assistant.'],
];
foreach ($history as $turn) {
    $role    = ($turn['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
    $content = mb_substr(trim($turn['content'] ?? ''), 0, 2000);
    if (!empty($content)) {
        $messages[] = ['role' => $role, 'content' => $content];
    }
}
$messages[] = ['role' => 'user', 'content' => $message];

$host    = rtrim(getenv('OLLAMA_HOST') ?: 'http://ollama:11434', '/');
$payload = json_encode([
    'model'       => $model,
    'messages'    => $messages,
    'temperature' => 0.7,
    'stream'      => false,
]);

$ch = curl_init($host . '/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 300,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
]);

$response = curl_exec($ch);
$code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err      = curl_error($ch);
curl_close($ch);

if ($err || !$response) {
    ob_end_clean();
    http_response_code(502);
    echo json_encode(['error' => 'Ollama unreachable: ' . $err]);
    exit;
}

$result  = json_decode($response, true);
$content = trim($result['choices'][0]['message']['content'] ?? '');

if (empty($content)) {
    ob_end_clean();
    http_response_code(502);
    echo json_encode(['error' => 'Empty response from model', 'raw' => $result]);
    exit;
}

ob_end_clean();
echo json_encode([
    'reply' => $content,
    'model' => $model,
]);
