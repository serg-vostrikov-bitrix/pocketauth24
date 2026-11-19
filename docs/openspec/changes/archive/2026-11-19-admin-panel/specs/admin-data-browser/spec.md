## ADDED Requirements

### Requirement: Read-only data tables
Every logged-in admin user SHALL see four read-only tables:
- Portals: ID, origin, `client_id`, number of applications, created at.
- Applications: ID, portal origin, `client_id`, title, redirect URI, scope, created at.
- Tokens: ID, portal origin, application title, `client_id`, user ID, scope, created at, access expires at, refresh expires at, state (active or expired).
- Event counters: day, outcome, count.

The admin API SHALL provide only `GET` endpoints for these tables.

#### Scenario: Viewer opens the tokens table
- **WHEN** a viewer opens the tokens table
- **THEN** the table shows token metadata and no edit or delete control

### Requirement: No secrets in admin data
The admin API and UI SHALL NOT return token values, token hashes, secret hashes or any content of the `params` column of token pairs.

#### Scenario: Tokens response
- **WHEN** an admin calls the tokens endpoint
- **THEN** the response contains no `access_hash`, `refresh_hash`, `secret_hash` or `params` field

### Requirement: Search by fields
Each table SHALL accept one filter per column. Text columns SHALL match a case-insensitive substring. Numeric ID columns SHALL match exactly. Date columns SHALL accept a from/to range. The state column of tokens SHALL accept `active` or `expired`. Filters SHALL combine with AND. The server SHALL apply filters in SQL with bound parameters.

#### Scenario: Find tokens of one user on one portal
- **WHEN** an admin filters the tokens table by portal origin `crm.example` and user ID `5`
- **THEN** the table shows only token pairs of user 5 on portals whose origin contains `crm.example`

#### Scenario: Injection attempt
- **WHEN** a filter value contains `' OR 1=1 --`
- **THEN** the server treats it as plain text and returns only matching rows

### Requirement: Visual style of the admin panel
The admin UI SHALL use the same dark theme and design tokens as the status page. It SHALL use subtle animations only (for example, page and row transitions, focus and hover states). When the browser reports `prefers-reduced-motion: reduce`, the admin UI SHALL stop all non-essential animations. The gyroscope animation SHALL NOT appear on data pages; it can appear on the login page.

#### Scenario: Admin opens a data table
- **WHEN** an admin opens the tokens table
- **THEN** the table uses the dark theme, and rows appear with a short fade-in

### Requirement: Pagination
Each table SHALL return at most 50 rows per page and a total count, newest rows first.

#### Scenario: Large table
- **WHEN** the tokens table has 1,000 rows
- **THEN** the first page shows 50 rows and the total 1,000
