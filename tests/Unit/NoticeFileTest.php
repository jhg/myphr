<?php

declare(strict_types=1);

/**
 * La licencia de LOINC obliga a incluir su aviso literal en un fichero de texto cuando el
 * proyecto se distribuye en un medio de almacenamiento (ADR 0005). Una obligación de licencia
 * que solo vive en un documento se incumple; este test la ata al repositorio.
 */
it('incluye el fichero NOTICE con el aviso literal de LOINC', function (): void {
    $path = dirname(__DIR__, 2).'/NOTICE';

    expect(file_exists($path))->toBeTrue();

    // El aviso se reparte en varias líneas por legibilidad; se compara con los saltos de
    // línea colapsados a espacios para no acoplar el test al ancho de columna del fichero.
    $notice = preg_replace('/\s+/', ' ', file_get_contents($path));

    expect($notice)->toContain('This material contains content from LOINC (http://loinc.org)')
        ->toContain('copyright © Regenstrief')
        ->toContain('http://loinc.org/license')
        ->toContain('LOINC® is a registered United States trademark of Regenstrief Institute, Inc.');
});
