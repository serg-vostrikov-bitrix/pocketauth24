# b24auth-server

[English](README.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · **Español** · [Português](README.pt.md) · [Русский](README.ru.md)

**Mantén en funcionamiento las aplicaciones locales de un portal Bitrix24 on-premise sin acceso a internet.**

[![CI](https://github.com/serg-vostrikov-bitrix/b24auth-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/serg-vostrikov-bitrix/b24auth-server/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-153%20passing-brightgreen)
![Contract tests](https://img.shields.io/badge/contract--tested-captured%20cloud%20traffic-blue)
![Closed network](https://img.shields.io/badge/closed%20network-verified%20on%20test%20portal-blue)
![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
<br>
![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)

b24auth-server es un servidor independiente y autoalojado. Responde a las llamadas OAuth que un portal Bitrix24 on-premise enviaría, de otro modo, al servidor OAuth en la nube (`oauth.bitrix.info` / `oauth.bitrix24.tech`). Se ejecuta como un solo contenedor con una base de datos PostgreSQL 17 dentro de tu red. Apunta el portal al servidor: las aplicaciones locales se abren, llaman a REST, renuevan tokens y reciben eventos sin conexión a la nube.

> Proyecto de código abierto independiente. No es un producto de Bitrix24. Consulta el [aviso legal](#aviso-legal).

![La página de estado pública de b24auth-server: estado del servicio y de la base de datos, portales, aplicaciones locales, pares de tokens activos y entregas de eventos](docs/images/status-page.png)

_La página de estado en `/`. Muestra solo recuentos agregados._

## 🔒 Por qué

Un portal Bitrix24 on-premise depende del servidor OAuth en la nube para sus aplicaciones locales. Cuando el portal no puede llegar a internet, las aplicaciones locales no se abren, no pueden llamar a REST con tokens, no pueden renovar tokens y no reciben eventos en línea.

Los equipos de redes corporativas cerradas y entornos regulados se quedan con dos malas opciones: renunciar a las aplicaciones locales o abrir una ruta a internet que no quieren. b24auth-server les ofrece una tercera: ejecutar el lado OAuth de las aplicaciones locales dentro de su propia red.

**Compensa también con acceso a internet.** Si los portales de tus clientes ejecutan solo tus propias aplicaciones locales, el servidor OAuth remoto en la nube aporta poco: los inicios de aplicación, las comprobaciones y las renovaciones de tokens siguen yendo a un servidor que no controlas, y su disponibilidad y la ruta de red hasta él quedan fuera de tus manos. Con b24auth-server junto al portal, esa dependencia pasa a una infraestructura que operas y supervisas tú. La contrapartida: tras el cambio, el portal deja de usar el servidor OAuth en la nube, por lo que las aplicaciones de Marketplace dejan de funcionar en él. Esta configuración es para portales que usan solo aplicaciones locales.

## ✨ Ventajas

- **Las apps locales sobreviven al aislamiento de red.** Una red cerrada ya no excluye las integraciones a medida en el portal.
- **Una dependencia externa menos.** Las aplicaciones locales no necesitan ninguna ruta de salida al servidor OAuth en la nube.
- **Tu disponibilidad, no la de otros.** Incluso en un portal conectado a internet que ejecuta solo tus apps locales, los inicios de aplicación, las comprobaciones y las renovaciones de tokens ya no dependen de la disponibilidad de un servidor remoto. (Las apps de Marketplace necesitan la nube y no funcionan tras el cambio.)
- **Limita el impacto de una fuga de base de datos o de logs.** Los tokens y secretos se guardan solo como hashes, y las query strings nunca llegan a los logs.
- **Un servidor, varios portales.** Socios y operadores no necesitan una instancia por portal.
- **Poco consumo.** Un contenedor, una base de datos, una comprobación `/health`, logs JSON en stdout y copias de seguridad estándar de PostgreSQL.
- **Código abierto.** Con licencia MIT, para que los integradores puedan leerlo, auditarlo y adaptarlo.

## 🧩 Funciones disponibles hoy

| Área                        | Qué obtienes                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registro del portal**     | El portal se registra solo en su próxima llamada OAuth. El registro está limitado a una lista de permitidos (`PORTAL_ALLOWLIST`, comparada por host y puerto). Cada llamada al servicio se autentica con las credenciales propias del portal, y todos los datos quedan limitados al portal que llama.                                                                                                       |
| **Aplicaciones locales**    | Crea, actualiza y elimina aplicaciones locales en el portal como de costumbre. El servidor emite `client_id` (`local.<14 hex>.<8 digits>`) y `client_secret` y mantiene su registro sincronizado. Al eliminar una app se eliminan todos sus tokens.                                                                                                                                                         |
| **Tokens**                  | `rest.authorize` emite pares de tokens para el usuario correcto, incluidos los no administradores; las páginas de instalación se abren con tokens. `rest.check` valida los tokens. El scope del token es la intersección entre el scope solicitado y el de la aplicación.                                                                                                                                   |
| **Renovación**              | `/oauth/token/` (GET o POST) con `grant_type=refresh_token`. Los refresh tokens se pueden reutilizar hasta que caducan, igual que en el tráfico de la nube capturado. Los access tokens duran 3600 s y los refresh tokens 180 días; los pares caducados se eliminan cada hora.                                                                                                                              |
| **Eventos**                 | `rest.event.call` entrega cada evento al manejador de la aplicación mediante HTTP POST, incluido `ONAPPINSTALL` con tokens recién emitidos. El portal recibe una respuesta inmediata.                                                                                                                                                                                                                       |
| **Seguridad**               | Almacenamiento con hash de tokens y secretos, tokens de una fuente aleatoria criptográficamente segura, ocultación en logs (sin query strings, URL de manejadores sin credenciales), puerto de la app enlazado a loopback (`127.0.0.1:3000`) en `docker-compose.yml`.                                                                                                                                       |
| **Operación**               | Una página de estado pública en `/` (estado del servicio y de la base de datos, recuentos de portales, aplicaciones, pares de tokens activos y entregas de eventos) y los mismos datos en JSON en `/api/status`. `/health` devuelve HTTP 503 cuando PostgreSQL no responde. Logs JSON, barra final aceptada en todas las rutas.                                                                             |
| **Panel de administración** | Un panel de administración multiusuario en `/admin`: tablas de solo lectura y con búsqueda de portales, aplicaciones locales, metadatos de tokens (sin tokens ni hashes) y contadores diarios de eventos. La contraseña del superusuario solo se establece con la CLI; el superusuario gestiona a los lectores en el panel. Las sesiones duran 12 horas; los inicios de sesión tienen límite de frecuencia. |

## ⚙️ Cómo funciona

```mermaid
sequenceDiagram
    participant P as Bitrix24 on-premise portal
    participant S as b24auth-server
    participant A as Local application
    P->>S: Register (allowlisted host)
    S-->>P: Service credentials
    P->>S: Add local application
    S-->>P: client_id / client_secret
    P->>S: rest.authorize (user opens the app)
    S-->>P: Access + refresh token
    A->>P: REST call with access token
    P->>S: rest.check
    S-->>P: Token valid for this user
    A->>S: /oauth/token/ (refresh_token)
    S-->>A: New token pair
    P->>S: rest.event.call (e.g. ONAPPINSTALL)
    S->>A: HTTP POST to handler, with tokens
```

El tráfico OAuth entre el portal, las aplicaciones locales y el servidor se queda dentro de tu red. El proxy inverso delante del servidor termina TLS y restringe quién puede llegar a cada ruta.

## ✅ Verificado

| Comprobación                            | Qué cubre                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **153 pruebas automatizadas**           | Pruebas de integración con PostgreSQL real para el registro del portal, el registro de aplicaciones, el servicio de tokens, la entrega de eventos, el enrutamiento y health, además de pruebas unitarias.                                                                                                                                                 |
| **Pruebas de contrato**                 | Formas de respuesta y códigos de error comparados con el tráfico capturado entre un portal de prueba (`rest` 26.1100) y `oauth.bitrix.info`.                                                                                                                                                                                                              |
| **Prueba de humo del contenedor (CI)**  | El contenedor arranca, `/health` responde, responden la página de estado y `/api/status`, un portal se registra, no hay logs de nivel error y el proceso no se ejecuta como root.                                                                                                                                                                         |
| **De extremo a extremo en red cerrada** | Una lista de comprobación de 10 pasos en un portal de prueba local en Docker (`rest` 26.1100) cuyo contenedor PHP estaba aislado de internet: registro, creación de la app, página de instalación con tokens, REST como administrador y no administrador, `ONAPPINSTALL` con tokens, renovación y renovación repetida, eliminación. Los 10 pasos pasaron. |

Aún no se ha ejecutado en producción en un cliente. Algunos detalles se dedujeron en lugar de capturarse de la nube: algunos códigos de estado HTTP (`invalid_client`, método desconocido, `expired_token`) y la forma exacta de un bloque `auth` de un evento con tokens.

## 🚀 Inicio rápido

No hay una imagen publicada: constrúyela en una máquina con acceso a internet y llévala a la red cerrada.

```bash
# Outside the closed network
docker build -t b24auth-server:<version> .
docker pull postgres:17
docker save b24auth-server:<version> postgres:17 -o b24auth-server-<version>.tar

# Inside the closed network (copy the tar and docker-compose.yml first)
docker load -i b24auth-server-<version>.tar
docker tag b24auth-server:<version> b24auth-server:local
```

Crea `.env` junto a `docker-compose.yml`:

| Variable            | Ejemplo                                         | Significado                                                                                                                                                                       |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`          | `https://auth.corp.local`                       | URL pública detrás del proxy; se convierte en `server_endpoint`.                                                                                                                  |
| `DATABASE_URL`      | `postgres://b24auth:<password>@db:5432/b24auth` | Conexión a la base de datos.                                                                                                                                                      |
| `PORTAL_ALLOWLIST`  | `portal.corp.local,crm.corp.local:8443`         | `host[:port]` de los portales que pueden registrarse; indica explícitamente los puertos no estándar.                                                                              |
| `POSTGRES_PASSWORD` | `<password>`                                    | La misma contraseña que en `DATABASE_URL`.                                                                                                                                        |
| `TRUST_PROXY`       | `true`                                          | Opcional. Solo acepta `true` o `false`. Pon `true` solo si el proxy sobrescribe `X-Forwarded-For` con la IP del cliente (nginx: `$remote_addr`, no `$proxy_add_x_forwarded_for`). |

`BASE_URL`, `DATABASE_URL` y `PORTAL_ALLOWLIST` son obligatorias; el servidor no arranca sin ellas. Después:

```bash
docker compose up -d                       # migrations run on start
curl https://auth.corp.local/health        # {"status":"ok"}
```

**Proxy inverso (obligatorio).** Redirige `https://<BASE_URL host>/` a `http://<app host>:3000/` con un certificado de tu CA interna. Deniega por defecto; permite cada ruta solo desde las IP de los servidores del portal, excepto `/oauth/token`, `/health` y, si lo deseas, la página de estado (`/`, `/assets/*`, `/api/status`). Haz coincidir las rutas con y sin la barra final.

**Apunta el portal al servidor.** En el panel de administración, "Línea de comandos PHP":

```php
\Bitrix\Main\Config\Option::set('rest', 'oauth_server', 'https://auth.corp.local');
\Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_id']);
\Bitrix\Main\Config\Option::delete('rest', ['name' => 'service_client_secret']);
```

También puedes definir `BITRIX_OAUTH_URL` en `local/php_interface/init.php` (anula la opción `oauth_server`; no edites `dbconn.php`). El portal se registra solo en su próxima llamada OAuth.

**Después:** vuelve a crear las aplicaciones locales que se crearon cuando el portal usaba la nube y cambia las URL de token escritas en el código (`https://oauth.bitrix.info/oauth/token/`, usada por la mayoría de los SDK, incluido CRest) por `https://auth.corp.local/oauth/token/`, o apunta el DNS interno de los nombres de host de la nube al proxy con un certificado de la CA interna.

Pasos completos, operación y reversión: [docs/deployment.md](docs/deployment.md).

## 🖥️ Requisitos del lado del portal

Encontrados durante la ejecución de extremo a extremo. Son comportamientos del portal, no defectos del servidor.

- El portal debe conocer su **URL pública y puerto reales**; de lo contrario, el marco de la app recibe un `DOMAIN` incorrecto y `BX24` no puede llegar al portal.
- Las URL de aplicaciones y manejadores necesitan un **nombre de host con un punto** (un FQDN o una dirección IP); `localhost` se rechaza.
- **Sirve el script `BX24` internamente.** Las apps suelen cargarlo desde `//api.bitrix24.com/api/v1/`, que es inalcanzable en una red cerrada.
- El portal rechaza las llamadas REST de un usuario que nunca ha iniciado sesión.

## ⚡ Rendimiento de la entrega de eventos

**Cómo funciona la entrega.** El portal envía todos los eventos de una petición (hit) en un solo lote `rest.event.call`. El lote no tiene límite de tamaño y el portal no lo reintenta. El servidor responde `{"result":null}` de inmediato y entrega cada evento en segundo plano, en el mismo proceso. Cada evento recibe un intento de HTTP POST con un tiempo límite de 10 segundos.

**Límites.** Los valores están fijados en [`src/config.ts`](src/config.ts).

| Límite                                      | Valor | Cuándo se alcanza                                                                  |
| ------------------------------------------- | ----- | ---------------------------------------------------------------------------------- |
| Entregas simultáneas en total               | 200   | El evento se descarta y se registra como `event_dropped_overload`, `limit: global` |
| Entregas simultáneas a un host de manejador | 100   | El evento se descarta y se registra como `event_dropped_overload`, `limit: host`   |
| Tiempo límite de una entrega                | 10 s  | La entrega se detiene y se registra como `event_delivery_failed`                   |

Un host de manejador es el host y el puerto de la URL del manejador. El límite por host es la mitad del límite total. Así, un manejador lento puede ocupar como máximo 100 ranuras, y los demás manejadores conservan siempre 100 ranuras. El límite por host no es menor porque un hit del portal puede enviar un lote grande a un solo manejador, por ejemplo durante una importación masiva.

**Qué le cuesta al servidor un manejador lento.** Una entrega que espera al manejador mantiene una conexión abierta y una pequeña cantidad de memoria. No mantiene una conexión a la base de datos: el servidor emite los tokens antes de enviar el POST. El bucle de eventos no se bloquea. Si todos los manejadores esperan hasta el tiempo límite, el servidor entrega como máximo 20 eventos por segundo en total y 10 eventos por segundo a un host. Los eventos siguientes se descartan.

**Recomendaciones para los manejadores de las aplicaciones.**

- Responde en menos de un segundo. Acepta el evento, ponlo en tu propia cola y luego procésalo.
- Da a cada aplicación pesada su propio host de manejador. Así una aplicación lenta solo usa sus propias 100 ranuras.
- Supervisa el log del servidor en busca de `event_dropped_overload`. El campo `limit` indica qué límite se alcanzó.

Los eventos descartados o fallidos no se reenvían. Una cola persistente con reintentos es una etapa posterior propuesta.

## 🧭 Limitaciones y hoja de ruta

Conócelas antes de desplegar:

- **Solo aplicaciones locales.** Las aplicaciones de Marketplace no funcionan, porque sus secretos están en la nube.
- **Las apps existentes deben volver a crearse**, y las URL de token escritas en el código deben cambiarse o redirigirse.
- **El proxy es el control de seguridad del registro.** El portal no envía ningún secreto compartido, así que quien llegue a `/oauth/register/` con la dirección de un portal permitido podría rotar las credenciales de ese portal. Restríngelo por IP.
- **Los eventos se entregan una vez**, con un tiempo límite de 10 segundos. No se almacenan ni se reintentan, se pierden al reiniciar y se descartan por encima de 200 entregas simultáneas en total o 100 entregas simultáneas a un host de manejador. Consulta [Rendimiento de la entrega de eventos](#-rendimiento-de-la-entrega-de-eventos).
- **Instancia única.** Las migraciones se ejecutan al arrancar sin bloqueo.
- **No compatible:** comprobaciones de licencia, el grant `authorization_code`, tratamiento en el servidor de install/uninstall. Las duraciones de los tokens son fijas; los cuerpos de las peticiones están limitados a 10 MB.
- **Panel de administración de solo lectura.** El panel muestra datos, pero no puede cambiar portales, aplicaciones ni tokens. No tiene SSO, autenticación de dos factores ni registro de auditoría. Restringe `/admin` y `/api/admin` en el proxy.
- **Probado** con el módulo `rest` del portal 26.1100.

Etapas posteriores propuestas, sin fechas: OAuth 2.0 completo e introspección (incluida la revocación al desinstalar y las comprobaciones de scope), una cola persistente de eventos con reintentos y funciones de operación como la migración de un portal ya registrado.

## 🔁 CI/CD

La CI se ejecuta en los push a `main` y en las pull requests ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job         | Qué hace                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| `test`      | Node.js 24 con un servicio PostgreSQL 17: `npm ci`, lint, typecheck, pruebas, build. |
| `container` | Construye e inicia el stack de Docker Compose y ejecuta la prueba de humo.           |
| `audit`     | `npm audit` para las dependencias de producción con severidad alta.                  |

Dependabot revisa cada semana los paquetes npm, las GitHub Actions y las imágenes base de Docker.

Todavía no hay ningún paso automático de release o publicación: ni pipeline de CD ni imagen publicada. La imagen la construyes tú.

## 📚 Documentación

- [Guía de despliegue](docs/deployment.md): requisitos, pasos, reglas del proxy, operación, reversión.
- [Lista de comprobación de extremo a extremo](docs/e2e-checklist.md): la verificación de 10 pasos en red cerrada.
- [Captura de protocolo](docs/protocol-capture.md): cómo se grabó el tráfico de la nube para las pruebas de contrato.
- [Investigación](docs/research/2026-11-18-oauth-server-analysis.md): análisis del protocolo y hoja de ruta propuesta.
- [Manual de usuario](docs/launchkit/01-user-manual.en.md): escenarios, casos de error, límites.

## 🛠️ Desarrollo

Stack: Node.js 24, TypeScript (strict), Fastify, Drizzle, PostgreSQL 17.

```bash
npm install
docker compose up -d db
npm test
```

Otros scripts: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run db:generate`.

Configuración: `BASE_URL`, `DATABASE_URL`, `PORTAL_ALLOWLIST` (consulta [`.env.example`](.env.example)).

## 📄 Licencia

[MIT](LICENSE). Copyright 2026 Serg Vostrikov.

## Aviso legal

b24auth-server es un proyecto independiente. No está afiliado a Bitrix24, ni cuenta con su respaldo o certificación. "Sustituto del servidor OAuth en la nube" describe lo que hace el software, no una relación con un proveedor. Bitrix24 y otras marcas pertenecen a sus respectivos propietarios.
