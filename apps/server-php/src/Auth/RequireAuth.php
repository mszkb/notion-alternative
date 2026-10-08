<?php

declare(strict_types=1);

namespace NotionAlt\Auth;

use NotionAlt\Http\HttpError;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Rejects requests without a valid session (401) and stores the {@see AuthContext} as request
 * attribute.
 */
final class RequireAuth implements MiddlewareInterface
{
    /**
     * @param \Closure(): \PDO $db
     */
    public function __construct(private readonly \Closure $db) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $token = self::token($request);
        $row = $token !== null ? Sessions::findUser(($this->db)(), $token) : null;
        if ($token === null || $row === null) {
            throw new HttpError(401, 'unauthorized', 'Authentication required');
        }

        return $handler->handle($request->withAttribute(
            AuthContext::ATTRIBUTE,
            new AuthContext(Users::toUser($row), $row['device_id'], $token),
        ));
    }

    /** The session token from the cookie, if any. */
    public static function token(ServerRequestInterface $request): ?string
    {
        $token = $request->getCookieParams()[Sessions::COOKIE] ?? null;

        return \is_string($token) && $token !== '' ? $token : null;
    }
}
