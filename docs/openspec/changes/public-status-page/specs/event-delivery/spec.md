## ADDED Requirements

### Requirement: Count delivery outcomes
For each event item, the server SHALL increment one daily counter for the current UTC day: `delivered` when the handler responds with HTTP 2xx, `failed` when the handler responds with another status or the request fails, `dropped` when the in-flight cap rejects the item. The counters SHALL store no event content, handler URL, portal or application. A failure to write a counter SHALL NOT change the delivery and SHALL be logged.

#### Scenario: Successful delivery
- **WHEN** the handler of an event responds with HTTP 200
- **THEN** the `delivered` counter for the current UTC day increases by 1

#### Scenario: Handler error
- **WHEN** the handler responds with HTTP 500 or the request times out
- **THEN** the `failed` counter for the current UTC day increases by 1

#### Scenario: Overload
- **WHEN** the in-flight cap rejects an event item
- **THEN** the `dropped` counter for the current UTC day increases by 1
