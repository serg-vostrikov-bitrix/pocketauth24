## ADDED Requirements

### Requirement: Health check includes the database
`GET /health` SHALL run a short query against PostgreSQL. If the query succeeds within 2 seconds, the server SHALL respond with HTTP 200 and `{"status":"ok"}`. Otherwise the server SHALL respond with HTTP 503 and `{"status":"error","database":"down"}`.

#### Scenario: Database is available
- **WHEN** a client calls `GET /health` and PostgreSQL answers
- **THEN** the server responds with HTTP 200 and `{"status":"ok"}`

#### Scenario: Database is not available
- **WHEN** a client calls `GET /health` and PostgreSQL does not answer within 2 seconds
- **THEN** the server responds with HTTP 503 and `{"status":"error","database":"down"}`

### Requirement: Public status endpoint
`GET /api/status` SHALL return JSON with: service status, database status, server version, the number of portals, the number of local applications, the number of active token pairs (refresh token not expired), and event delivery counts (delivered, failed, dropped) for the current UTC day and for the last 7 UTC days. The endpoint SHALL NOT require authentication.

#### Scenario: Status with a healthy database
- **WHEN** a client calls `GET /api/status` and PostgreSQL answers
- **THEN** the server responds with HTTP 200 and all fields listed above

#### Scenario: Status with a failed database
- **WHEN** a client calls `GET /api/status` and PostgreSQL does not answer
- **THEN** the server responds with HTTP 200, database status `down`, and null for every statistic

### Requirement: Public data contains no sensitive values
The status endpoint and the status page SHALL NOT expose secrets, token values, token hashes, `client_id` values, portal hosts, user IDs or handler URLs. They SHALL expose aggregate counts only.

#### Scenario: Response content
- **WHEN** a client reads the response of `GET /api/status`
- **THEN** the response contains no portal host, `client_id`, token, hash, user ID or URL

### Requirement: Statistics are cached
The server SHALL compute the statistics at most once in 10 seconds and SHALL serve the cached result between computations.

#### Scenario: Repeated requests
- **WHEN** a client calls `GET /api/status` 100 times within 10 seconds
- **THEN** the server runs the statistics queries at most once

### Requirement: Public status page
`GET /` SHALL return the status page. The page SHALL show the service and database state and the statistics from `GET /api/status`, and SHALL refresh them every 30 seconds. The page SHALL load no resources from outside the server.

#### Scenario: Operator opens the root URL
- **WHEN** a browser opens `/`
- **THEN** it shows the health state and the statistics without a login

#### Scenario: Closed network
- **WHEN** the browser has no internet access
- **THEN** the page loads completely, because all scripts, styles and fonts come from the server

### Requirement: Visual style
The UI SHALL use a dark theme. The style SHALL be calm and reliable and SHALL give an impression of high technology. Interface elements SHALL use short, subtle animations (for example, fade-in of cards and smooth changes of values). When the browser reports `prefers-reduced-motion: reduce`, the UI SHALL stop all non-essential animations.

#### Scenario: Default appearance
- **WHEN** a browser opens `/`
- **THEN** the page shows a dark background, light text and subtle transitions when the statistics refresh

#### Scenario: Reduced motion
- **WHEN** the operating system of the user requests reduced motion
- **THEN** the page shows the same content without animations

### Requirement: Gyroscope animation on the status page
The status page SHALL show a continuous animation of several nested circles. Each circle SHALL rotate at its own speed around its own axis in 3D, with a soft glow, like a futuristic gyroscope. The animation SHALL run on the GPU (CSS 3D transforms or SVG), SHALL load no external library or resource, and SHALL NOT hide the health state or the statistics. When the database or the service is down, the animation SHALL change its color to the error color.

#### Scenario: Healthy service
- **WHEN** the service and the database are healthy
- **THEN** the gyroscope rotates continuously with the normal accent color and glow

#### Scenario: Database down
- **WHEN** `GET /api/status` reports the database as `down`
- **THEN** the gyroscope uses the error color

#### Scenario: Unknown path stays JSON
- **WHEN** a client calls a path that is not a route and not a static file
- **THEN** the server responds with HTTP 404 and the JSON body `{"error":"not_found","error_description":"Not found"}`
