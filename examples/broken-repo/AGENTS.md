# Demo agent instructions

Read `docs/architecture.md` before changing the request pipeline.

Run `just publish-demo` before opening a pull request.

Always preserve quartz cache rollout metadata during release validation.
Never preserve quartz cache rollout metadata during release validation.

Review every changed endpoint against the public compatibility contract before approval.
Keep each migration reversible until the production verification window has closed.
Record the owning service and rollback signal for every operational change request.

Use best practices when necessary.

TODO: replace this temporary launch guidance.

The local helper lives at `/Users/demo/amigolint/scripts/check.ts`.
