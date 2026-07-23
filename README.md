# reddit-travel-monitor

Personal read-only monitoring script for travel subreddits (r/rome, r/ItalyTravel, r/travel).

Fetches new public posts once per day, filters them by travel-related keywords
(colosseum, rome tickets, tours), and outputs a private daily summary for the
author's personal review.

- Read-only: no posting, no commenting, no voting, no messaging.
- All replies to threads are written and posted manually by the author from his own account.
- Runs as a scheduled job (GitHub Actions), a few dozen read requests per day.
- Descriptive User-Agent, standard rate-limit compliance.
