# Prompt: Code Review

Please code review this like a principal engineer building enterprise grade software. We should be using modern best practices and techniques and libraries without fluff but built clear, logical, systematic code that can be used as an example of best practices for other engineers to replicate and learn from.

please ensure that you're solving the root cause of these issues and not chasing workarounds and hacks. a principal engineering approach built for reliability and maintainability is crucial here.

Before you make a solid suggestion on this, make sure to ask yourself this question.

Does this work comply with our mandate to always be writing code like a principal engineer building enterprise software that is intended to be used as an example of best practices for other engineers and teams to emulate?

## Code Review item example format

⏺ Issue 1 of 16: Upload endpoint has no authentication

Severity: Critical
Location: src/routes/api/upload/+server.ts

What: Anyone on the internet can POST to /api/upload and generate presigned R2 URLs, allowing them to upload
arbitrary files to your bucket at your expense.

Recommendation: Require a valid Stripe PaymentIntent ID in the request. The upload should only work for users
who have already initiated a payment. This ties the upload to a real checkout session without needing separate
auth.

Pros:

- Prevents storage cost attacks from anonymous actors
- No separate auth system needed — reuses Stripe as the gatekeeper
- Ensures uploads only happen in the context of a real order

Cons:

- Changes the flow slightly — PaymentIntent must be created before upload (currently upload happens before
  payment)
- Could alternatively use a simpler approach like a CSRF token or rate limiting

What's your call — fix now, skip, or file a GitHub issue?
