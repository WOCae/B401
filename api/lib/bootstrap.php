<?php
declare(strict_types=1);
namespace PM;

define('PM_ROOT', dirname(__DIR__, 2));
ini_set('serialize_precision', '-1'); // json_encode の小数が 0.08 のまま出るように
mb_internal_encoding('UTF-8');

require __DIR__ . '/schema.php';
require __DIR__ . '/storage.php';
require __DIR__ . '/tools.php';
