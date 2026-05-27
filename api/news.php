<?php
declare(strict_types=1);

// Disable all output buffering — SSE requires flushing directly to the client
while (ob_get_level() > 0) ob_end_clean();
@ini_set('output_buffering',        '0');
@ini_set('zlib.output_compression', '0');
ini_set('display_errors', '0');
ini_set('log_errors',     '1');
set_time_limit(300);      // allow up to 5 min for per-article CPU inference
ignore_user_abort(true);  // keep running if client disconnects (writes cache)

header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');  // disable nginx/proxy buffering
header('Access-Control-Allow-Origin: *');

// ── SSE helper ─────────────────────────────────────────────────────────────
function sse(string $event, mixed $data): void {
    echo "event: {$event}\n";
    echo 'data: ' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
}

// ── Feed registry ──────────────────────────────────────────────────────────
const FEEDS = [
    'world-news' => [
        ['url' => 'https://feeds.bbci.co.uk/news/world/rss.xml',   'source' => 'BBC World'],
        ['url' => 'https://feeds.skynews.com/feeds/rss/world.xml', 'source' => 'Sky News'],
    ],
    'malaysia-news' => [
        ['url' => 'https://www.malaymail.com/feed',          'source' => 'Malay Mail'],
        ['url' => 'https://www.freemalaysiatoday.com/feed/', 'source' => 'FMT'],
    ],
    'world-economy' => [
        ['url' => 'https://feeds.bbci.co.uk/news/business/rss.xml',                             'source' => 'BBC Business'],
        ['url' => 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', 'source' => 'MarketWatch'],
    ],
    'malaysia-economy' => [
        ['url' => 'https://www.thestar.com.my/rss/business/business-news/', 'source' => 'The Star Business'],
        ['url' => 'https://www.theedgemarkets.com/rss.xml',                 'source' => 'The Edge Markets'],
    ],
];

// ── Validate input ─────────────────────────────────────────────────────────
$tab = $_GET['tab'] ?? '';
if (!array_key_exists($tab, FEEDS)) {
    sse('error', ['message' => 'Invalid tab. Allowed: ' . implode(', ', array_keys(FEEDS))]);
    exit;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Fetch a single URL via cURL ────────────────────────────────────────────
function fetchUrl(string $url, int $timeout = 8): string|false
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_USERAGENT      => UA,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_ENCODING       => 'gzip, deflate',
        CURLOPT_HTTPHEADER     => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-GB,en;q=0.9',
        ],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ($body !== false && $code === 200) ? $body : false;
}

function fetchRss(string $url): string|false { return fetchUrl($url, 8); }

// ── Parallel article page fetching (curl_multi) ────────────────────────────
// Returns array keyed by index => HTML string or false
function fetchArticlePages(array $urls, int $timeout = 7): array
{
    $mh      = curl_multi_init();
    $handles = [];

    foreach ($urls as $i => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_USERAGENT      => UA,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 2,
            CURLOPT_ENCODING       => 'gzip, deflate',
            CURLOPT_HTTPHEADER     => [
                'Accept: text/html,application/xhtml+xml,*/*;q=0.8',
                'Accept-Language: en-GB,en;q=0.9',
            ],
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$i] = $ch;
    }

    $running = 0;
    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh, 0.2);
    } while ($running > 0);

    $results = [];
    foreach ($handles as $i => $ch) {
        $body        = curl_multi_getcontent($ch);
        $code        = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $results[$i] = ($body && $code === 200) ? $body : false;
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);

    return $results;
}

// ── Extract main article text from an HTML page ────────────────────────────
function extractArticleText(string $html): string
{
    // Suppress malformed HTML warnings
    libxml_use_internal_errors(true);
    $dom = new DOMDocument('1.0', 'UTF-8');
    // Prepend charset declaration — avoids deprecated mb_convert_encoding('HTML-ENTITIES') in PHP 8.2
    $dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
    libxml_clear_errors();

    $xpath = new DOMXPath($dom);

    // Remove noise nodes
    $noiseSelectors = [
        '//script', '//style', '//nav', '//header', '//footer',
        '//aside', '//form', '//iframe', '//noscript',
        '//*[contains(@class,"ad")]', '//*[contains(@class,"promo")]',
        '//*[contains(@class,"related")]', '//*[contains(@class,"sidebar")]',
        '//*[contains(@class,"cookie")]', '//*[contains(@class,"newsletter")]',
        '//*[contains(@id,"comment")]', '//*[contains(@class,"comment")]',
    ];
    foreach ($noiseSelectors as $sel) {
        foreach ($xpath->query($sel) ?: [] as $node) {
            $node->parentNode?->removeChild($node);
        }
    }

    // Try targeted article content selectors first (most specific → least)
    $contentSelectors = [
        '//article//p',
        '//*[contains(@class,"article-body")]//p',
        '//*[contains(@class,"article-content")]//p',
        '//*[contains(@class,"story-body")]//p',
        '//*[contains(@class,"entry-content")]//p',
        '//*[contains(@class,"post-content")]//p',
        '//*[contains(@class,"content-body")]//p',
        '//*[contains(@itemprop,"articleBody")]//p',
        '//main//p',
        '//p',
    ];

    foreach ($contentSelectors as $sel) {
        $nodes = $xpath->query($sel);
        if (!$nodes || $nodes->length === 0) continue;

        $paragraphs = [];
        foreach ($nodes as $p) {
            $text = preg_replace('/\s+/', ' ', trim($p->textContent));
            // Skip very short snippets (nav links, captions, etc.)
            if (mb_strlen($text) >= 40) {
                $paragraphs[] = $text;
            }
        }

        if (count($paragraphs) >= 2) {
            $full = implode("\n\n", $paragraphs);
            // Limit to ~1400 chars (~3-5 paragraphs)
            if (mb_strlen($full) > 1400) {
                $full = mb_substr($full, 0, 1400);
                // Trim to last complete sentence
                if (($pos = mb_strrpos($full, '.')) !== false) {
                    $full = mb_substr($full, 0, $pos + 1);
                }
            }
            return $full;
        }
    }

    return '';
}

// ── English language detection ───────────────────────────────────────────
// Returns true if the text is predominantly ASCII Latin characters (English).
function isEnglish(string $text): bool
{
    if (empty($text)) return true;
    // Remove whitespace and punctuation to measure real character content
    $stripped = preg_replace('/[\s\p{P}\p{N}]/u', '', $text);
    if (strlen($stripped) === 0) return true;
    // Count ASCII printable letters (a-z, A-Z)
    $asciiLetters = preg_replace('/[^a-zA-Z]/', '', $stripped);
    return (strlen($asciiLetters) / strlen($stripped)) >= 0.80;
}

// ── Parse RSS XML into article array ──────────────────────────────────────
function parseRss(string $xml, string $source): array
{
    libxml_use_internal_errors(true);
    $doc = simplexml_load_string($xml);
    if ($doc === false) return [];

    $articles = [];
    $items    = $doc->channel->item ?? [];

    foreach ($items as $item) {
        $title = trim((string)($item->title ?? ''));
        $link  = trim((string)($item->link  ?? ''));

        // Some feeds put link in CDATA or guid
        if (empty($link)) {
            $link = trim((string)($item->guid ?? ''));
        }

        // Only accept http/https links
        if (empty($title) || !preg_match('#^https?://#', $link)) continue;

        // Strip HTML from description
        $desc = strip_tags((string)($item->description ?? ''));
        $desc = preg_replace('/\s+/', ' ', trim($desc));
        if (strlen($desc) > 800) $desc = substr($desc, 0, 800) . '…';

        // All feeds in the registry are English-language sources; skip language filter
        // (isEnglish() was too aggressive — rejected Malaysian English outlets with mixed content)

        $pubDate = trim((string)($item->pubDate ?? ''));
        $ts      = strtotime($pubDate);

        $articles[] = [
            'title'  => $title,
            'link'   => $link,
            'desc'   => $desc ?: null,
            'date'   => $ts ? date('Y-m-d H:i', $ts) : $pubDate,
            'ts'     => $ts ?: 0,
            'source' => $source,
        ];

        if (count($articles) >= 15) break;
    }

    return $articles;
}

// ── Generic OpenAI-compatible AI summarization ────────────────────────────
// Works with Ollama (/v1/chat/completions), Groq, or any OpenAI-compatible API.
// Strategy: Groq → one batch call (fast cloud).
//           Ollama CPU → one call per article (batch prompts overflow context).
function generateAiSummaries(
    array  $articles,
    string $endpoint,
    string $model,
    string $apiKey      = '',
    int    $timeout     = 240,
    bool   $perArticle  = false   // true = individual calls (Ollama CPU)
): array {
    if (empty($articles)) return [];

    $headers = ['Content-Type: application/json'];
    if (!empty($apiKey)) {
        $headers[] = 'Authorization: Bearer ' . $apiKey;
    }

    // ── Per-article mode (Ollama CPU) ──────────────────────────────────────
    if ($perArticle) {
        $summaries = [];
        foreach ($articles as $article) {
            $title   = $article['title'];
            $content = mb_substr(preg_replace('/\s+/', ' ', $article['desc'] ?? ''), 0, 400);
            $prompt  = "Summarize this news article in 2-3 clear sentences covering what happened, who is involved, and why it matters.\n\nTitle: {$title}\n\n{$content}\n\nSummary:";

            $payload = json_encode([
                'model'       => $model,
                'messages'    => [['role' => 'user', 'content' => $prompt]],
                'temperature' => 0.3,
                'max_tokens'  => 200,
                'stream'      => false,
            ]);

            $ch = curl_init($endpoint);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => $timeout,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $payload,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_HTTPHEADER     => $headers,
            ]);
            $response = curl_exec($ch);
            $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            $text = '';
            if ($response && $code === 200) {
                $data = json_decode($response, true);
                $text = trim($data['choices'][0]['message']['content'] ?? '');
            }
            $summaries[] = $text; // empty string = failed, badge shows "AI unavailable"
        }
        return $summaries;
    }

    // ── Batch mode (Groq / cloud) ──────────────────────────────────────────
    $articleList = '';
    foreach ($articles as $i => $article) {
        $n       = $i + 1;
        $title   = $article['title'];
        $content = mb_substr(preg_replace('/\s+/', ' ', $article['desc'] ?? ''), 0, 400);
        $articleList .= "Article {$n}: {$title}\n{$content}\n\n";
    }

    $count  = count($articles);
    $prompt = <<<PROMPT
You are a professional news summarizer. Below are {$count} news articles.
For each article, write a clear and informative 2-sentence summary covering what happened and why it matters.

Return ONLY a valid JSON object in this exact format with no extra text or markdown:
{"summaries": ["summary for article 1", "summary for article 2", ...]}

{$articleList}
PROMPT;

    $payload = json_encode([
        'model'       => $model,
        'messages'    => [['role' => 'user', 'content' => $prompt]],
        'temperature' => 0.3,
        'max_tokens'  => 1200,
        'stream'      => false,
    ]);

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => $headers,
    ]);

    $response = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!$response || $code !== 200) return [];

    $data    = json_decode($response, true);
    $content = trim($data['choices'][0]['message']['content'] ?? '');
    $content = preg_replace('/^```(?:json)?\s*/i', '', $content);
    $content = preg_replace('/\s*```$/i',           '', $content);

    $parsed = json_decode($content, true);
    if (!isset($parsed['summaries']) || !is_array($parsed['summaries'])) return [];

    return $parsed['summaries'];
}

// ── Summarize a single article (Ollama CPU mode) ───────────────────────────
function summarizeOne(array $article, string $endpoint, string $model, string $apiKey, int $timeout): array
{
    $title   = $article['title'];
    $content = mb_substr(preg_replace('/\s+/', ' ', $article['desc'] ?? ''), 0, 400);
    $prompt  = "Summarize this news article in 5 sentences: what happened, who is involved, key details or context, and why it matters.\n\nTitle: {$title}\n\n{$content}\n\nSummary:";

    $headers = ['Content-Type: application/json'];
    if (!empty($apiKey)) $headers[] = 'Authorization: Bearer ' . $apiKey;

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'model'       => $model,
            'messages'    => [['role' => 'user', 'content' => $prompt]],
            'temperature' => 0.3,
            'max_tokens'  => 350,
            'stream'      => false,
        ]),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response && $code === 200) {
        $data = json_decode($response, true);
        $text = trim($data['choices'][0]['message']['content'] ?? '');
        if (!empty($text)) {
            $article['desc']       = $text;
            $article['ai_summary'] = true;
        }
    }
    return $article;
}

// ── Cache setup ────────────────────────────────────────────────────────────
const CACHE_TTL = 180; // seconds (3 minutes)
const CACHE_DIR = '/tmp/watcher_cache';

if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0700, true);
$cacheFile = CACHE_DIR . '/news_' . md5($tab) . '.json';

// Cache HIT: stream cached articles instantly then done
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    $cached = json_decode(file_get_contents($cacheFile), true);
    if ($cached && isset($cached['articles'])) {
        sse('meta', ['ai_attempted' => $cached['ai_attempted'] ?? false, 'total' => count($cached['articles'])]);
        foreach ($cached['articles'] as $article) {
            sse('article', $article);
        }
        sse('done', [
            'count'        => $cached['count'] ?? count($cached['articles']),
            'ai_attempted' => $cached['ai_attempted'] ?? false,
            'errors'       => $cached['errors'] ?? [],
            'fetched'      => $cached['fetched'] ?? '',
            'cached'       => true,
        ]);
        exit;
    }
}

// ── Step 1: Fetch RSS feeds ────────────────────────────────────────────────
sse('status', ['message' => 'Fetching news feeds…']);
$allArticles = [];
$errors      = [];

foreach (FEEDS[$tab] as $feed) {
    $raw = fetchRss($feed['url']);
    if ($raw === false) {
        $errors[] = "Failed to fetch: {$feed['source']}";
        continue;
    }
    $allArticles = array_merge($allArticles, parseRss($raw, $feed['source']));
}

usort($allArticles, fn($a, $b) => $b['ts'] - $a['ts']);
$allArticles = array_slice($allArticles, 0, 2); // change this number to control total articles fetched

// ── Step 2: Enrich articles with full page content ─────────────────────────
sse('status', ['message' => 'Loading article content…']);
$enrichTargets = [];
foreach ($allArticles as $i => $article) {
    if (mb_strlen($article['desc'] ?? '') < 200) {
        $enrichTargets[$i] = $article['link'];
    }
}
if (!empty($enrichTargets)) {
    $pages = fetchArticlePages(array_values($enrichTargets), 7);
    $keys  = array_keys($enrichTargets);
    foreach ($keys as $j => $articleIndex) {
        $html = $pages[$j] ?? false;
        if (!$html) continue;
        $extracted = extractArticleText($html);
        if (mb_strlen($extracted) > mb_strlen($allArticles[$articleIndex]['desc'] ?? '')) {
            $allArticles[$articleIndex]['desc'] = $extracted;
        }
    }
}

// ── Step 3: AI summaries + stream each article as it completes ─────────────
$aiProvider  = strtolower(trim(getenv('AI_PROVIDER') ?: ''));
$aiAttempted = $aiProvider !== '';
$total       = count($allArticles);
$outputArticles = [];

sse('meta', ['ai_attempted' => $aiAttempted, 'total' => $total]);

if ($aiProvider === 'ollama') {
    $host  = rtrim(getenv('OLLAMA_HOST') ?: 'http://ollama:11434', '/');
    $model = getenv('OLLAMA_MODEL') ?: 'llama3.2:3b';
    foreach ($allArticles as $idx => $article) {
        sse('status', ['message' => "AI summary {$idx}/{$total}…"]);
        $article = summarizeOne($article, $host . '/v1/chat/completions', $model, '', 90);
        unset($article['ts']);
        $outputArticles[] = $article;
        sse('article', $article);
    }
} elseif ($aiProvider === 'groq') {
    $apiKey = getenv('GROQ_API_KEY') ?: '';
    if (!empty($apiKey)) {
        sse('status', ['message' => 'Generating AI summaries…']);
        $summaries = generateAiSummaries($allArticles, 'https://api.groq.com/openai/v1/chat/completions', 'llama3-8b-8192', $apiKey, 30);
        foreach ($allArticles as $i => $article) {
            if (isset($summaries[$i]) && !empty(trim($summaries[$i]))) {
                $article['desc'] = trim($summaries[$i]);
                $article['ai_summary'] = true;
            }
            unset($article['ts']);
            $outputArticles[] = $article;
            sse('article', $article);
        }
    } else {
        foreach ($allArticles as $article) { unset($article['ts']); $outputArticles[] = $article; sse('article', $article); }
    }
} else {
    foreach ($allArticles as $article) { unset($article['ts']); $outputArticles[] = $article; sse('article', $article); }
}

// ── Save to cache ──────────────────────────────────────────────────────────
@file_put_contents($cacheFile, json_encode([
    'tab'          => $tab,
    'count'        => count($outputArticles),
    'articles'     => $outputArticles,
    'errors'       => $errors,
    'ai_attempted' => $aiAttempted,
    'fetched'      => date('Y-m-d H:i:s'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

sse('done', [
    'count'        => count($outputArticles),
    'ai_attempted' => $aiAttempted,
    'errors'       => $errors,
    'fetched'      => date('Y-m-d H:i:s'),
    'cached'       => false,
]);
