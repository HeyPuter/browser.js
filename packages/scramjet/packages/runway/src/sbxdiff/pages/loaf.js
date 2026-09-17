// Blocks the main thread long enough for a long animation frame.
//
// An external file so `scripts[].sourceURL` names something other than the
// document -- a proxy that rewrote this script reports the rewritten URL here.
//
// A fixed iteration count rather than a deadline read off the clock: the
// harness pins the clock, so a loop that waits for `performance.now()` to
// advance 60ms either never ends or ends instantly depending on the policy.
function sbxdiffBlock() {
	let x = 0;
	for (let i = 0; i < 200000000; i++) x += i % 7;

	return x;
}
window.sbxdiffBlock = sbxdiffBlock;
