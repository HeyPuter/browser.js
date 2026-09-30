import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";

// MARK: helpers
// TODO: instance properly
let exceptionId = 0;
function createExceptionDetails(
	session: CDPSession,
	error: unknown
): Protocol.Runtime.ExceptionDetails {
	return {
		exceptionId: exceptionId++,
		text: "Uncaught",
		exception: session.objects.wrap(error),
		lineNumber: 0,
		columnNumber: 0,
		stackTrace: {
			callFrames: [],
		},
	};
}

// MARK: enable/disable
bindCDP("Runtime.enable", function () {
	this.enableDomain("Runtime");
});

bindCDP("Runtime.disable", function () {
	this.disableDomain("Runtime");
});

// MARK: evaluation
bindCDP("Runtime.evaluate", async function (params) {
	if (!this.isDomainEnabled("Runtime")) {
		throw new Error("Runtime not enabled");
	}
	let result: unknown;
	let error: unknown;
	try {
		result = this.context.client.indirectEval(params.expression);
	} catch (e) {
		result = error = e;
	}

	const res: Partial<Protocol.Runtime.EvaluateResponse> = {
		result: this.objects.wrap(result),
	};
	if (error) res.exceptionDetails = createExceptionDetails(this, error);

	return res;
});

bindCDP("Runtime.compileScript", async function (params) {
	// TODO: implement
});
