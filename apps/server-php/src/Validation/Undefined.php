<?php

declare(strict_types=1);

namespace NotionAlt\Validation;

/** A missing value (JavaScript's `undefined`): an absent object key or request body. */
enum Undefined
{
    case Value;
}
