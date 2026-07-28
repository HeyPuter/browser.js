import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";

// TODO: instance properly
let exceptionId = 0;
function createExceptionDetails(
	session: CDPSession,
	error: any
): Protocol.Runtime.ExceptionDetails {
	const wrapped = session.objects.wrap(error);
	console.log(wrapped);
	return {
		exceptionId: exceptionId++,
		text: "Uncaught",
		exception: wrapped,
		lineNumber: 0,
		columnNumber: 0,
		stackTrace: {
			callFrames: [],
		},
	};
}

bindCDP("Runtime.enable", function () {
	console.log("runtime enabled!");
	this.runtimeEnabled = true;
});

bindCDP("Runtime.evaluate", async function (params) {
	if (!this.runtimeEnabled) {
		throw new Error("Runtime not enabled");
	}
	const {
		expression,
		objectGroup,
		includeCommandLineAPI,
		silent,
		contextId,
		returnByValue,
		generatePreview,
		userGesture,
		awaitPromise,
	} = params;
	let result;
	let error;
	try {
		result = this.context.client.indirectEval(expression);
	} catch (_error) {
		result = error = _error;
	}

	const wrappedResult = this.objects.wrap(result);

	const res: Partial<Protocol.Runtime.EvaluateResponse> = {};
	res.result = wrappedResult;
	if (error) res.exceptionDetails = createExceptionDetails(this, error);

	return res;
});

bindCDP("Runtime.compileScript", async function (params) {
	const { expression, sourceMapURL, persistScript } = params;
});
