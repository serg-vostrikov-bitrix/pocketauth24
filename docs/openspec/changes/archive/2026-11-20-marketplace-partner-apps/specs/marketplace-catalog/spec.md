## ADDED Requirements

### Requirement: Catalog of Marketplace applications
The server SHALL keep a catalog of Marketplace applications that it can serve. A catalog entry
SHALL hold the `client_id`, the hash of the `client_secret`, the title and the scope. One entry
SHALL apply to all portals that the server accepts.

#### Scenario: Entry serves all portals
- **WHEN** the catalog has an entry for `client_id` `app.a1.1`, and portals A and B install it
- **THEN** the server accepts both installs and keeps them apart

### Requirement: Manage the catalog through the CLI
The CLI SHALL add, list and remove catalog entries. The operator SHALL be the only person who
changes the catalog; the admin panel and the RPC methods SHALL NOT change it. The CLI SHALL read
the `client_secret` from a hidden prompt or from standard input, never from a command argument.
Adding an entry with a `client_id` that is already in the catalog SHALL replace its secret, title
and scope. The list SHALL show the `client_id`, the title and the scope, and SHALL NOT show the secret or its hash.

#### Scenario: Add an entry
- **WHEN** the operator adds `client_id` `app.a1.1` with a title, scope `crm,user` and a secret
- **THEN** the catalog contains the entry and stores only the hash of the secret

#### Scenario: Rotate the secret
- **WHEN** the operator adds `app.a1.1` again with a new secret
- **THEN** renewal with the old secret fails with `invalid_client` and renewal with the new secret succeeds

#### Scenario: Remove an entry
- **WHEN** the operator removes `app.a1.1`
- **THEN** the server deletes all installs of `app.a1.1` and all their tokens

### Requirement: Safe storage of catalog secrets
The server SHALL store a catalog `client_secret` only as a hash. Logs SHALL NOT contain the
secret.

#### Scenario: Database leak
- **WHEN** the catalog table is read directly
- **THEN** it contains no usable `client_secret`
