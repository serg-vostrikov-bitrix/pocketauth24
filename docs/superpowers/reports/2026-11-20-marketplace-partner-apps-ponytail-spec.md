# Ponytail review: marketplace-partner-apps (open phase)

| Finding | Action |
| --- | --- |
| `marketplace-catalog`: refusal of the `local.` prefix guards a case that cannot occur (Marketplace codes never use it) | Removed from spec, design and tasks |
| `marketplace-catalog`: install count in `marketplace list` duplicates the admin panel | Removed |
| `application-registry`: scenario "Install after `Application not installed`" repeats the install scenario and the existing `rest.authorize` behaviour | Removed |
| `token-service`: scenario "Wrong catalog secret" repeats the rotation scenario and the existing "Wrong application secret" | Removed |
| Explicit rejection of `application.install.subscription` | Kept: without it the administrator sees `ERROR_METHOD_NOT_FOUND`, which does not explain the cause |
| Task 5.1 (admin view with a null `secret_hash`) | Kept: the column becomes nullable, and the admin view must not break |
