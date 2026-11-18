# Project rules

## 1. Language of technical artifacts

Write all technical artifacts in English only. This rule applies to:

- documentation (README, guides, architecture notes, ADRs);
- specifications (OpenSpec, Comet, proposals, designs, task lists);
- code, code comments and docstrings;
- commit messages, branch names, pull requests and issues.

The conversation with the developer can be in another language. When a source document is not in
English, translate it. Do not quote it in the original language.

## 2. Style of specifications: ASD-STE100 (about 80%)

Write specifications in ASD-STE100 Simplified Technical English (STE). Apply the rules to
approximately 80% of the text. Specialized terminology is permitted.

### What ASD-STE100 is

ASD-STE100 is the "Simplified Technical English" specification. ASD (AeroSpace, Security and
Defence Industries Association of Europe) maintains it. "100" is the number of the specification.
The aerospace industry made it to write maintenance documentation that people can read without
errors, also when English is not their first language. STE has two parts:

1. A set of writing rules.
2. A controlled dictionary: approved words, each with one meaning and one part of speech.

### Rules to apply

**Words**

- Use one word for one meaning. Use one name for one thing. Do not use synonyms for variety
  (for example, do not mix "token", "access key" and "credential" for the same object).
- Use simple, common words. Prefer "use" to "utilize", "start" to "initiate", "show" to
  "demonstrate", "make sure" to "ensure".
- Use a verb only as a verb and a noun only as a noun.
- Do not make noun clusters of more than three words. Rewrite "OAuth token refresh retry
  policy" as "the retry policy for the refresh of the OAuth token".
- Do not use phrasal verbs with an unclear meaning ("set up", "carry out", "look into") when a
  simple verb is available.

**Sentences**

- Keep procedural sentences to 20 words or fewer.
- Keep descriptive sentences to 25 words or fewer.
- Write one instruction per sentence. Two actions at the same time can be in one sentence.
- Use the active voice. Write "The server rejects the request", not "The request is rejected".
- Use the imperative for instructions: "Send the request", not "You should send the request".
- Write the condition first: "If the token expires, request a new token."
- Use articles ("a", "an", "the") where possible. They make the structure clear.
- Do not use "-ing" forms as nouns or adjectives where another form is possible.
- Use only simple tenses: present, past and future.

**Paragraphs**

- Write one topic per paragraph.
- Keep a paragraph to six sentences or fewer.
- Use lists and tables for steps, conditions, values and comparisons.

**Requirements and warnings**

- Use "must" for a requirement. Use "should" for a recommendation. Use "can" for an option.
  Do not use "shall" or "may".
- Start a warning with a clear command. Then give the risk.

### The permitted 20%

STE is a guide here, not a strict rule set. Deviations are permitted in these cases:

- **Technical names**: the names of products, protocols, APIs, classes, fields, endpoints, errors
  and configuration keys (for example: OAuth 2.0, `access_token`, Bitrix24, webhook, JWT,
  `client_secret`, HTTP 401). Use them as they are.
- **Technical verbs** of the domain: "deploy", "authenticate", "authorize", "serialize", "cache",
  "refresh", "revoke", "redirect", "hash".
- **Domain terms** that have no simple equivalent: "idempotent", "race condition", "scope",
  "tenant", "callback".
- **Rationale and design discussion**: sentences can be longer when a strict split makes the
  logic unclear. Keep them clear and direct.

Do not use the permitted 20% for vague words, long sentences without need, the passive voice
without a reason, or marketing language.

### Example

Not STE:

> The access token should be refreshed by the client utilizing the refresh token prior to its
> expiration in order to ensure uninterrupted access to the Bitrix24 REST API.

STE (about 80%):

> Refresh the access token before it expires. Use the refresh token for this.
> If the access token expires, the Bitrix24 REST API returns HTTP 401.
