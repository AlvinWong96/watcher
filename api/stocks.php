<?php
declare(strict_types=1);

ob_start();
ini_set('display_errors', '0');
ini_set('log_errors', '1');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=60'); // cache 1 min

// ── Input validation ───────────────────────────────────────────────────────
$symbol = strtoupper(trim($_GET['symbol'] ?? '^KLSE'));
$range  = $_GET['range']  ?? '3mo';

if (!preg_match('/^[\^A-Z0-9.\-]{1,20}$/', $symbol)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid symbol format']);
    exit;
}

$allowedRanges = ['1mo', '3mo', '6mo', '1y', '2y'];
if (!in_array($range, $allowedRanges, true)) $range = '3mo';

// ── Fetch from Yahoo Finance ───────────────────────────────────────────────
function fetchYahoo(string $symbol, string $range): array|false
{
    $url = sprintf(
        'https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=%s',
        rawurlencode($symbol),
        $range
    );

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_ENCODING       => 'gzip, deflate',
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Accept-Language: en-US,en;q=0.9',
        ],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $code !== 200) return false;

    $data = json_decode($body, true);
    return (is_array($data) && isset($data['chart']['result'][0])) ? $data : false;
}

// ── Math helpers ───────────────────────────────────────────────────────────

/** Simple Moving Average */
function sma(array $data, int $period): array
{
    $result = [];
    $n = count($data);
    for ($i = 0; $i < $n; $i++) {
        if ($i < $period - 1) { $result[] = null; continue; }
        $slice     = array_slice($data, $i - $period + 1, $period);
        $result[]  = round(array_sum($slice) / $period, 4);
    }
    return $result;
}

/** Wilder's RSI (14-period by default) */
function rsi(array $data, int $period = 14): array
{
    $n      = count($data);
    $result = array_fill(0, $n, null);
    if ($n < $period + 1) return $result;

    $gains = []; $losses = [];
    for ($i = 1; $i < $n; $i++) {
        $d = $data[$i] - $data[$i - 1];
        $gains[]  = max($d, 0);
        $losses[] = max(-$d, 0);
    }

    $avgGain = array_sum(array_slice($gains, 0, $period)) / $period;
    $avgLoss = array_sum(array_slice($losses, 0, $period)) / $period;

    for ($i = $period; $i < $n; $i++) {
        if ($i > $period) {
            $avgGain = ($avgGain * ($period - 1) + $gains[$i - 1]) / $period;
            $avgLoss = ($avgLoss * ($period - 1) + $losses[$i - 1]) / $period;
        }
        $rs         = ($avgLoss == 0) ? 9999 : $avgGain / $avgLoss;
        $result[$i] = round(100 - 100 / (1 + $rs), 2);
    }
    return $result;
}

/** Ordinary Least Squares linear regression on closing prices */
function linearRegression(array $y): array
{
    $n = count($y);
    if ($n < 2) {
        return ['slope' => 0.0, 'intercept' => (float)end($y), 'stdDev' => 0.0, 'r2' => 0.0];
    }

    $xSum = 0.0; $ySum = 0.0; $xySum = 0.0; $x2Sum = 0.0;
    for ($i = 0; $i < $n; $i++) {
        $xSum  += $i;
        $ySum  += $y[$i];
        $xySum += $i * $y[$i];
        $x2Sum += $i * $i;
    }
    $denom     = $n * $x2Sum - $xSum * $xSum;
    $slope     = ($denom != 0) ? ($n * $xySum - $xSum * $ySum) / $denom : 0.0;
    $intercept = ($ySum - $slope * $xSum) / $n;

    // Residuals & R²
    $yMean = $ySum / $n;
    $ssTot = 0.0; $ssRes = 0.0;
    for ($i = 0; $i < $n; $i++) {
        $pred   = $slope * $i + $intercept;
        $ssRes += ($y[$i] - $pred) ** 2;
        $ssTot += ($y[$i] - $yMean) ** 2;
    }
    $stdDev = sqrt($ssRes / $n);
    $r2     = ($ssTot != 0) ? round(1 - $ssRes / $ssTot, 4) : 0.0;

    return [
        'slope'     => $slope,
        'intercept' => $intercept,
        'stdDev'    => $stdDev,
        'r2'        => $r2,
    ];
}

// ── Fetch & parse data ─────────────────────────────────────────────────────
$raw = fetchYahoo($symbol, $range);
if ($raw === false) {
    http_response_code(502);
    echo json_encode(['error' => "Could not fetch data for symbol '{$symbol}'. It may be invalid or unavailable."]);
    exit;
}

$result     = $raw['chart']['result'][0];
$meta       = $result['meta'];
$timestamps = $result['timestamp'] ?? [];
$q          = $result['indicators']['quote'][0] ?? [];

$closes  = $q['close']  ?? [];
$opens   = $q['open']   ?? [];
$highs   = $q['high']   ?? [];
$lows    = $q['low']    ?? [];
$volumes = $q['volume'] ?? [];

// Build clean history (skip null candles)
$history     = [];
$cleanCloses = [];

foreach ($timestamps as $i => $ts) {
    if (!isset($closes[$i]) || $closes[$i] === null) continue;
    $c = (float)$closes[$i];
    $history[] = [
        'date'   => date('Y-m-d', (int)$ts),
        'open'   => round((float)($opens[$i]   ?? $c), 4),
        'high'   => round((float)($highs[$i]   ?? $c), 4),
        'low'    => round((float)($lows[$i]    ?? $c), 4),
        'close'  => round($c, 4),
        'volume' => (int)($volumes[$i] ?? 0),
    ];
    $cleanCloses[] = $c;
}

if (empty($cleanCloses)) {
    http_response_code(404);
    echo json_encode(['error' => 'No price data available for this symbol/range']);
    exit;
}

// ── Indicators ─────────────────────────────────────────────────────────────
$n     = count($cleanCloses);
$sma7  = sma($cleanCloses, 7);
$sma20 = sma($cleanCloses, 20);
$rsi14 = rsi($cleanCloses, 14);

// ── Prediction: try Python ML service first, fall back to linear regression ─
$predictions  = [];
$predMethod   = 'Linear Regression';
$predMeta     = [];

$predictorHost = rtrim(getenv('PREDICTOR_HOST') ?: 'http://predictor:5000', '/');
$predictorUrl  = $predictorHost . '/predict';

$payload = json_encode([
    'closes'  => $cleanCloses,
    'volumes' => array_column($history, 'volume'),
    'dates'   => array_column($history, 'date'),
    'n_days'  => 7,
]);

$ch = curl_init($predictorUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
]);
$predResponse = curl_exec($ch);
$predCode     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($predResponse && $predCode === 200) {
    $predData = json_decode($predResponse, true);
    if (!empty($predData['predictions'])) {
        $predictions = $predData['predictions'];
        $models      = $predData['meta']['models_used'] ?? [];
        $predMethod  = 'ML Ensemble (' . implode(' + ', array_map('strtoupper', $models)) . ')';
        $predMeta    = $predData['meta'] ?? [];
    }
}

// Fallback: PHP linear regression
if (empty($predictions)) {
    $reg      = linearRegression($cleanCloses);
    $lastDate = new DateTime(end($history)['date']);
    $daysAdded = 0;
    $dayIndex  = $n;

    while ($daysAdded < 7) {
        $lastDate->modify('+1 day');
        if (in_array((int)$lastDate->format('N'), [6, 7])) continue;

        $predicted = max($reg['slope'] * $dayIndex + $reg['intercept'], 0.0001);
        $lastClose = end($cleanCloses);

        $predictions[] = [
            'date'   => $lastDate->format('Y-m-d'),
            'price'  => round($predicted, 4),
            'upper'  => round(max($predicted + 1.96 * $reg['stdDev'], 0.0001), 4),
            'lower'  => round(max($predicted - 1.96 * $reg['stdDev'], 0.0001), 4),
            'change' => round((($predicted - $lastClose) / $lastClose) * 100, 2),
        ];
        $daysAdded++;
        $dayIndex++;
    }
    $predMeta = [
        'r2'     => $reg['r2'],
        'slope'  => round($reg['slope'], 6),
        'stdDev' => round($reg['stdDev'], 4),
    ];
}

// ── Market metadata ────────────────────────────────────────────────────────
$currentPrice = (float)($meta['regularMarketPrice'] ?? end($cleanCloses));
$prevClose    = (float)($meta['chartPreviousClose']  ?? ($n >= 2 ? $cleanCloses[$n - 2] : $currentPrice));
$change       = $currentPrice - $prevClose;
$changePct    = ($prevClose != 0) ? ($change / $prevClose) * 100 : 0.0;

// Latest non-null RSI
$latestRsi = null;
foreach (array_reverse($rsi14) as $v) {
    if ($v !== null) { $latestRsi = $v; break; }
}

// Trend signal based on slope & RSI
$trendSignal = 'Neutral';
if ($reg['slope'] > 0 && $latestRsi !== null && $latestRsi < 70)  $trendSignal = 'Bullish';
if ($reg['slope'] < 0 && $latestRsi !== null && $latestRsi > 30)  $trendSignal = 'Bearish';
if ($latestRsi !== null && $latestRsi >= 70)  $trendSignal = 'Overbought';
if ($latestRsi !== null && $latestRsi <= 30)  $trendSignal = 'Oversold';

ob_end_clean();
echo json_encode([
    'symbol'        => $meta['symbol']    ?? $symbol,
    'name'          => $meta['longName']  ?? ($meta['shortName'] ?? $symbol),
    'currency'      => $meta['currency']  ?? 'USD',
    'currentPrice'  => round($currentPrice, 4),
    'prevClose'     => round($prevClose, 4),
    'change'        => round($change, 4),
    'changePct'     => round($changePct, 2),
    'volume'        => (int)($meta['regularMarketVolume'] ?? (end($history)['volume'] ?? 0)),
    'marketCap'     => $meta['marketCap'] ?? null,
    'rsi'           => $latestRsi,
    'trendSignal'   => $trendSignal,
    'history'       => $history,
    'sma7'          => $sma7,
    'sma20'         => $sma20,
    'predictions'   => $predictions,
    'predMethod'    => $predMethod,
    'predMeta'      => $predMeta,
    'fetched'       => date('Y-m-d H:i:s'),
], JSON_NUMERIC_CHECK | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
