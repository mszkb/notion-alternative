<?php

declare(strict_types=1);

namespace NotionAlt\Http;

use NotionAlt\Logging\Logger;

/**
 * Work that runs after the response was sent (push hints): PHP-FPM ends the request with
 * `fastcgi_finish_request()`, other SAPIs get a `Content-Length` and flushed output, so the
 * client is not kept waiting. Failures are logged, never shown to the client.
 */
final class AfterResponse
{
    /** @var list<\Closure(bool): void> */
    private array $tasks = [];

    /**
     * @param \Closure(bool): void $task gets whether the response is already finished for the
     *                                   client (only then may it wait, e.g. for bundled hints)
     */
    public function add(\Closure $task): void
    {
        $this->tasks[] = $task;
    }

    public function pending(): bool
    {
        return $this->tasks !== [];
    }

    /** Ends the response if the SAPI can, then runs the tasks. */
    public function run(Logger $logger, bool $finishResponse = true): void
    {
        if ($this->tasks === []) {
            return;
        }
        $finished = false;
        if ($finishResponse) {
            ignore_user_abort(true);
            if (\function_exists('fastcgi_finish_request')) {
                $finished = fastcgi_finish_request();
            } else {
                while (ob_get_level() > 0) {
                    ob_end_flush();
                }
                flush();
            }
        }
        $tasks = $this->tasks;
        $this->tasks = [];
        foreach ($tasks as $task) {
            try {
                $task($finished);
            } catch (\Throwable $error) {
                $logger->error('task after response failed', ['err' => Logger::serializeError($error)]);
            }
        }
    }
}
