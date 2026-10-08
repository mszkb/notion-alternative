<?php

declare(strict_types=1);

namespace NotionAlt\Push;

/** Sends a {@see PushRequest} with ext-curl: no redirects, 10 s timeout (like `sendPush` in Node). */
final class PushSender
{
    /** Status code of the push service, 0 if the request failed. */
    public static function send(PushRequest $request): int
    {
        if (!\function_exists('curl_init')) {
            throw new \RuntimeException('Web Push needs the PHP extension curl');
        }
        $headers = [];
        foreach ($request->headers as $name => $value) {
            $headers[] = "{$name}: {$value}";
        }
        $headers[] = 'Expect:';
        $curl = curl_init($request->url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $request->body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        $ok = curl_exec($curl) !== false;
        $status = $ok ? curl_getinfo($curl, CURLINFO_RESPONSE_CODE) : 0;
        curl_close($curl);

        return $status;
    }
}
