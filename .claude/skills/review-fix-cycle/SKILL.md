---
name: review-fix-cycle
description: How to run review → reproduce → fix rounds on scramjet changes (with an external reviewer such as codex), without making fidelity worse. Use when asked to review a PR or branch and then fix what it finds, to relaunch another review round, or to judge whether a change is ready to merge.
---

# Review–test–fix cycles on scramjet

**The goal is behaving like Chrome, not following the spec.** Scramjet succeeds when a site can't tell it's proxied. Where Chrome and the spec disagree, Chrome wins. Judge every change by what plain Chrome does, observed in a test, not by what a document or a reviewer says it should do.

**Every claim needs a reproduction against two baselines.** A finding from a reviewer, another model or your own reading is only a hypothesis. Before acting, show it in a test that runs in both scramjet and bare Chrome. Then run the same test on the code before the change. That second comparison sorts each finding into one of three groups:

- **A regression:** worked before, broken now. Fix these.
- **Pre-existing:** was already wrong. Usually leave these and record them.
- **Not real:** didn't reproduce. Drop these.

Many confident findings land in the last two groups.

**Fix narrowly and keep a test for each fix.** For every confirmed fix, add a regression test that would have caught it. When something is left wrong on purpose, record it as a known failure with the reason, rather than deleting the test. Commit per round so each round can be reviewed or reverted on its own.

**Watch where new findings come from.** The number of findings per round tells you little. What matters is whether they come from the original change or from your own previous fixes. If your fixes keep producing new bugs in the same area, stop patching it. Going back to the last known-good behavior is often the better fix, even if it's less precise.

**Not all errors cost the same.** Before choosing between two imperfect behaviors, ask which mistake real sites tolerate. Sending a little more than Chrome usually goes unnoticed; sending less, or something wrong, breaks logins and forms. When you can't be exact, err toward the harmless direction.

**Complexity is a cost.** Code that exists only for a contrived case has to earn its place. It runs on hot paths, interacts with everything, and has been the source of real regressions. Removing it is often worth more than perfecting it. Some of it is a deliberate choice by the author, so ask before removing it.

**Prefer what the browser reports over what page code reports.** Information that comes from the page's own context can be stale or chosen by the page. Information the browser reports is not. When both exist, believe the browser and use the page's version only as a fallback.

**Keep proxied URLs stable.** In a proxy, the URL is a resource's identity. Anything that makes the same resource's URL vary by context, such as who loaded it or when, can make it load twice or stop matching.

**Brief the external reviewer well.** Each round, tell it:

- what it's reviewing, and what matters most;
- what is intentionally open or out of scope, so it doesn't re-report it;
- what earlier rounds fixed, so it can question the fixes without re-raising the originals.

Narrow the scope as rounds go on, toward the newest and least-reviewed code. Give it the code, not your conclusions. Tell it to say plainly when it finds nothing rather than pad the list.

**Test economically and keep your evidence.**

- **Run targeted subsets, never the whole suite.** Pick the tests that touch what changed, and run the same subset before and after.
- **Store anything you'll need later somewhere durable.** That includes probe tests, baseline results and reviewer briefs; temporary folders get wiped between sessions.
- **Rerun failures alone before believing them.** Parallel runs are flaky.
- **Check which side failed.** Sometimes it's the plain-Chrome side, and the harness is at fault, not scramjet.

**Ask before outward or design decisions.** Get the user's go-ahead before pushing, and before cutting back a feature or choosing between imperfect behaviors. Present the trade-off and a recommendation. Don't pick silently.

**Report honestly.** State your confidence, and say plainly what you didn't verify: modes the tests can't reach, a CI that isn't running the tests, the parts of the product you never launched. List the regressions you're knowingly leaving, so the person deciding whether to merge can see them.

**Know when to stop.** You're done when new findings come back only as contrived cases, as already-wrong behavior, or as things you've chosen to leave. Waiting for a round with zero findings means waiting forever.
