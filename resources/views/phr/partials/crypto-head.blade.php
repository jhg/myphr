{{--
    Cabecera criptográfica del panel (Spec 0001 §10, «Filament»: módulo de cripto emitido en el
    `<head>` del panel).

    Publica tres valores **públicos** que el cliente OPAQUE necesita antes de derivar nada:

    * `profile`: el perfil vigente. El cliente aborta si la respuesta del servidor no lo repite
      exactamente (§5, paso 5).
    * `server-identity`: `identifiers.server` de RFC 9807. Tiene que coincidir carácter a carácter
      con `OPAQUE_SERVER_IDENTITY`; si no, todo login falla como «contraseña incorrecta».
    * `server-public-key`: la clave contra la que el cliente hace el pinning del paso 5 de §5. En el
      registro no existe todavía `server_mac`, así que es lo único que autentica al servidor.

    Ninguno es secreto: los tres viajan igual dentro de las respuestas de los endpoints.

    Si el setup no está configurado, las etiquetas se omiten y el cliente se niega a arrancar en vez
    de derivar contra valores inventados. En producción no puede ocurrir: `OpaqueServiceProvider`
    valida el setup en el arranque HTTP.
--}}
@php
    try {
        $opaqueSetup = app(\App\Security\Opaque\ServerSetup::class);
    } catch (\Throwable) {
        $opaqueSetup = null;
    }
@endphp

@if ($opaqueSetup !== null)
    <meta name="phr-opaque-profile" content="{{ $opaqueSetup->profile }}">
    <meta name="phr-opaque-server-identity" content="{{ $opaqueSetup->serverIdentity }}">
    <meta name="phr-opaque-server-public-key"
          content="{{ \App\Security\Opaque\Base64Url::encode($opaqueSetup->serverPublicKey) }}">
@endif

<meta name="phr-session-secret-url" content="{{ route('filament.phr.auth.session-secret') }}">
<meta name="phr-lock-url" content="{{ route('filament.phr.auth.lock') }}">
<meta name="phr-login-url" content="{{ route('filament.phr.auth.login') }}">

@vite('resources/js/app.js')
