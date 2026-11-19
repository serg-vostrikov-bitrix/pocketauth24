## ADDED Requirements

### Requirement: Superuser is set only through the CLI
The service SHALL provide the command `node dist/cli.js superuser set-password [--login <name>] [--password-stdin]`. The default login SHALL be `admin`. Without `--password-stdin`, the command SHALL read the password twice from the TTY with hidden input. The command SHALL NOT accept the password as an argument or an environment variable. If no superuser exists, the command SHALL create it. If a superuser exists, the command SHALL replace its password (and its login if `--login` is given) and SHALL revoke all its sessions.

#### Scenario: First setup
- **WHEN** the operator runs the command in the container and types the same password twice
- **THEN** the server stores the superuser with a hash of the password and prints a confirmation without the password

#### Scenario: Password from stdin
- **WHEN** the operator pipes a password to the command with `--password-stdin`
- **THEN** the command reads one line from stdin and sets the password

#### Scenario: Password change revokes sessions
- **WHEN** a superuser session exists and the operator sets a new password
- **THEN** the old session no longer authenticates any request

#### Scenario: Short or mismatched password
- **WHEN** the password has fewer than 12 characters, or the two prompts differ
- **THEN** the command exits with a non-zero code and changes nothing

### Requirement: Passwords are stored as salted scrypt hashes
The server SHALL hash each admin password with `scrypt` and a random 16-byte salt per password, and SHALL store only the parameters, the salt and the hash. Password comparison SHALL use a constant-time comparison.

#### Scenario: Stored value
- **WHEN** a password is set
- **THEN** the database contains no plain password, and two equal passwords produce different stored values

### Requirement: Admin panel is closed without a superuser
If no superuser exists, the login endpoint SHALL reject every login, and the login page SHALL show that the operator must run the CLI command. The server SHALL NOT create a default password.

#### Scenario: Fresh installation
- **WHEN** no superuser exists and a client sends a login request
- **THEN** the server responds with HTTP 503 and an error that names the CLI command

### Requirement: Login and sessions
`POST /api/admin/login` SHALL accept a login and a password. On success, the server SHALL create a session with a random 32-byte ID, store only a hash of the ID, and set the cookie `b24a_session` with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`. A session SHALL expire 12 hours after login. `POST /api/admin/logout` SHALL delete the session. Every `/api/admin/*` route except login SHALL respond with HTTP 401 without a valid session. A deleted admin user SHALL lose all sessions.

#### Scenario: Successful login
- **WHEN** an active admin user sends the correct login and password
- **THEN** the server responds with HTTP 200 and sets the session cookie

#### Scenario: Wrong password
- **WHEN** the password is wrong or the login does not exist
- **THEN** the server responds with HTTP 401 and the same error for both cases

#### Scenario: Expired session
- **WHEN** a request comes with a session created more than 12 hours ago
- **THEN** the server responds with HTTP 401

### Requirement: Login rate limit
The server SHALL allow at most 5 failed login attempts per client IP address in 15 minutes. Further attempts in that window SHALL get HTTP 429 without a password check.

#### Scenario: Brute force
- **WHEN** a client sends a sixth failed login within 15 minutes
- **THEN** the server responds with HTTP 429

### Requirement: State-changing requests are protected against CSRF
Every state-changing `/api/admin/*` request SHALL require the content type `application/json`. Together with `SameSite=Strict`, this blocks cross-site form posts.

#### Scenario: Cross-site form post
- **WHEN** a request to `POST /api/admin/users` has the content type `application/x-www-form-urlencoded`
- **THEN** the server responds with HTTP 415 and changes nothing

### Requirement: Login events are logged without secrets
The server SHALL log each login success, login failure and logout with the login name and the client IP address. The log SHALL NOT contain passwords, session IDs or cookie values.

#### Scenario: Failed login log
- **WHEN** a login fails
- **THEN** the log line contains the login name and the IP address, and no password
