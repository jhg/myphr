<?php

declare(strict_types=1);

/**
 * The LOINC licence requires including its verbatim notice in a text file when the project is
 * distributed on a storage medium (ADR 0005). A licence obligation that only lives in a document
 * gets broken; this test ties it to the repository.
 */
it('ships the NOTICE file with the verbatim LOINC notice', function (): void {
    $path = dirname(__DIR__, 2).'/NOTICE';

    expect(file_exists($path))->toBeTrue();

    // The notice is split across several lines for readability; it is compared with the line
    // breaks collapsed to spaces so the test is not coupled to the file's column width.
    $notice = preg_replace('/\s+/', ' ', file_get_contents($path));

    expect($notice)->toContain('This material contains content from LOINC (http://loinc.org)')
        ->toContain('copyright © Regenstrief')
        ->toContain('http://loinc.org/license')
        ->toContain('LOINC® is a registered United States trademark of Regenstrief Institute, Inc.');
});
