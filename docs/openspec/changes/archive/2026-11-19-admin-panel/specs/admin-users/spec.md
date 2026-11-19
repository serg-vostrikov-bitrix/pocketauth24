## ADDED Requirements

### Requirement: Two roles
An admin user SHALL have the role `superuser` or `viewer`. At most one superuser SHALL exist. Only the CLI SHALL create or change the superuser.

#### Scenario: Role of a new user
- **WHEN** the superuser creates an admin user in the panel
- **THEN** the new user has the role `viewer`

### Requirement: Superuser manages viewers
The superuser SHALL list, create and delete `viewer` users, and SHALL set a new password for a viewer. A new password SHALL have at least 12 characters. Delete and password reset SHALL revoke the sessions of that viewer.

#### Scenario: Create a viewer
- **WHEN** the superuser creates a viewer with a unique login and a valid password
- **THEN** the viewer can log in and see the data tables

#### Scenario: Delete a viewer
- **WHEN** the superuser deletes a viewer who has an active session
- **THEN** the next request of that viewer gets HTTP 401

### Requirement: The panel cannot change the superuser
User management endpoints SHALL reject every change to the superuser record with HTTP 403.

#### Scenario: Attempt to delete the superuser
- **WHEN** a request tries to delete or reset the password of the superuser through the panel
- **THEN** the server responds with HTTP 403 and changes nothing

### Requirement: Viewers cannot manage users
User management endpoints SHALL respond with HTTP 403 to a viewer.

#### Scenario: Viewer tries to create a user
- **WHEN** a viewer sends `POST /api/admin/users`
- **THEN** the server responds with HTTP 403
