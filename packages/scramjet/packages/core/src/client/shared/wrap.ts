import { iswindow } from "@client/entry";
import { SCRAMJETCLIENT } from "@/symbols";
import { ScramjetClient } from "@client/index";
// import { argdbg } from "@client/shared/err";
import { Object_defineProperty } from "@/shared/snapshot";

/** What `location op= rhs` computes, for the compound assignments that are arithmetic */
const ARITHMETIC: Record<string, (a: any, b: any) => any> = {
	"-=": (a, b) => a - b,
	"*=": (a, b) => a * b,
	"/=": (a, b) => a / b,
	"%=": (a, b) => a % b,
	"**=": (a, b) => a ** b,
	"<<=": (a, b) => a << b,
	">>=": (a, b) => a >> b,
	">>>=": (a, b) => a >>> b,
	"&=": (a, b) => a & b,
	"|=": (a, b) => a | b,
	"^=": (a, b) => a ^ b,
};

export function createWrapFn(client: ScramjetClient, self: GlobalThis) {
	let wrappedParent: Window | null = null;
	let wrappedTop: Window | null = null;
	if (iswindow) {
		const win = self as Self;
		try {
			if (SCRAMJETCLIENT in self.parent) {
				// ... then we're in a subframe, and the parent frame is also in a proxy context, so we should return its proxy
				wrappedParent = self.parent;
			} else {
				// ... then we should pretend we aren't nested and return the current window
				wrappedParent = win;
			}
		} catch {
			// accessing self.parent can throw if it's cross-origin, in which case we should also pretend we aren't nested
			wrappedParent = win;
		}
		// instead of returning top, we need to return the uppermost parent that's inside a scramjet context
		let current: Window = win;
		for (;;) {
			const test = current.parent.self;
			if (test === current) break; // there is no parent, actual or emulated.

			try {
				// ... then `test` represents a window outside of the proxy context, and therefore `current` is the topmost window in the proxy context
				if (!(SCRAMJETCLIENT in test)) break;
			} catch {
				// accessing test can throw if it's cross-origin, in which case we should also break
				break;
			}
			// test is also insde a proxy, so we should continue up the chain
			current = test;
		}
		wrappedTop = current;
	}

	// `ppsc` hands the page a window only as its proxy, and that has to hold for
	// the pretend parent and top too. Handing back the real one both leaks it
	// and breaks the usual walk to the top - `while (w !== w.parent) w =
	// w.parent` - which never sees the two agree: the proxy of a window is not
	// the window.
	if (client.globalProxy) {
		const proxyOf = (w: any) => {
			if (w === self) return client.globalProxy;
			try {
				return w?.[SCRAMJETCLIENT]?.globalProxy ?? w;
			} catch {
				return w;
			}
		};
		wrappedParent = proxyOf(wrappedParent);
		wrappedTop = proxyOf(wrappedTop);
	}

	// Under `ppsc` this is called on whatever a site hands it - a function's
	// `this`, a local that only sometimes holds the window - rather than only on
	// a global, so it is compared against values read once. `location`,
	// `parent`, `top` and `document` are accessors, and reading all four on
	// every call was the whole cost of the call: 312ms of its own and 236ms in
	// the getters over five iterations of TodoMVC-React-Redux. None of them
	// changes for the life of a window.
	const realLocation = self.location;
	const realDocument = iswindow ? (self as Self).document : null;
	const realParent = iswindow ? self.parent : null;
	const realTop = iswindow ? self.top : null;

	return function (identifier: any) {
		// nothing that is not an object can be one of them
		if (
			identifier === null ||
			(typeof identifier !== "object" && typeof identifier !== "function")
		)
			return identifier;
		// `ppsc` wraps references to the global object itself, which `dpsc` never does
		if (client.globalProxy) {
			if (identifier === self) return client.globalProxy;
			if (identifier === realDocument) return client.documentProxy;
		}
		if (identifier === realLocation) return client.locationProxy;
		if (identifier === self.eval) {
			return client.indirectEval;
		}
		if (iswindow) {
			if (identifier === realParent) {
				return wrappedParent;
			} else if (identifier === realTop) {
				return wrappedTop;
			}
		}
		return identifier;
	};
}

export const order = 4;
export default function (client: ScramjetClient, self: GlobalThis) {
	// a temporary slot that $call can use to store the receiver
	Object_defineProperty(self, client.config.globals.tempreceiverid, {
		value: undefined,
		writable: true,
		configurable: false,
		enumerable: false,
	});

	// the same, for the callee of an optional call, which has to be parked
	// before the arguments are evaluated so that a nullish one can skip them
	Object_defineProperty(self, client.config.globals.tempcalleeid, {
		value: undefined,
		writable: true,
		configurable: false,
		enumerable: false,
	});

	Object_defineProperty(self, client.config.globals.wrapfn, {
		value: client.wrapfn,
		writable: false,
		configurable: false,
		enumerable: false,
	});
	// `ppsc`: what a function's `this` is compared against before it is
	// wrapped. Fixed, so the engine can treat both as constants. A worker has
	// no document, and is given something no `this` can be.
	Object_defineProperty(self, client.config.globals.rawwindowid, {
		value: self,
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object_defineProperty(self, client.config.globals.rawdocumentid, {
		value: iswindow ? (self as Self).document : {},
		writable: false,
		configurable: false,
		enumerable: false,
	});
	// `ppsc`: the real object behind one of this realm's proxies, for the twin
	// kept beside a local that holds the proxy, which its safe uses read
	Object_defineProperty(self, client.config.globals.unwrapfn, {
		value: function (v: any) {
			if (v === client.globalProxy && v) return self;
			if (v === client.documentProxy && v) return (self as Self).document;

			return v;
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object_defineProperty(self, client.config.globals.wrappropertyfn, {
		value: function (str) {
			if (
				str === "location" ||
				str === "parent" ||
				str === "top" ||
				str === "eval"
			)
				return client.config.globals.wrappropertybase + str;

			return str;
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object_defineProperty(self, client.config.globals.cleanrestfn, {
		value: function (_obj) {
			// TODO
		},
		writable: false,
		configurable: false,
		enumerable: false,
	});

	Object_defineProperty(
		self.Object.prototype,
		client.config.globals.wrappropertybase + "location",
		{
			get: function () {
				// if (this.location.constructor.toString().includes("Location")) {

				if (this === self || this === self.document) {
					return client.locationProxy;
				}

				return this.location;
			},
			set(value: any) {
				if (this === self || this === self.document) {
					client.url = value;

					return;
				}
				this.location = value;
			},
			configurable: false,
			enumerable: false,
		}
	);
	Object_defineProperty(
		self.Object.prototype,
		client.config.globals.wrappropertybase + "parent",
		{
			get: function () {
				return client.wrapfn(this.parent);
			},
			set(value: any) {
				// i guess??
				this.parent = value;
			},
			configurable: false,
			enumerable: false,
		}
	);
	Object_defineProperty(
		self.Object.prototype,
		client.config.globals.wrappropertybase + "top",
		{
			get: function () {
				return client.wrapfn(this.top);
			},
			set(value: any) {
				this.top = value;
			},
			configurable: false,
			enumerable: false,
		}
	);
	Object_defineProperty(
		self.Object.prototype,
		client.config.globals.wrappropertybase + "eval",
		{
			get: function () {
				return client.wrapfn(this.eval);
			},
			set(value: any) {
				this.eval = value;
			},
			configurable: false,
			enumerable: false,
		}
	);

	// location = "..." can't be rewritten as wrapfn(location) = ..., so instead it will actually be rewritten as
	// ((t)=>$scramjet$tryset(location,"+=",t)||location+=t)(...);
	// it has to be a discrete function because there's always the possibility that "location" is a local variable
	// we have to use an IIFE to avoid duplicating side-effects in the getter
	Object_defineProperty(self, client.config.globals.trysetfn, {
		value: function (lhs: any, op: string, rhs: any) {
			// a real `Location`, this realm's or another frame's, navigates through the location
			// proxy of the client that owns it: setting `lhs.href` itself would navigate the frame
			// to the URL unrewritten. Anything else - a local named `location` - is the caller's
			// to assign.
			const owner = client.box.locations.get(lhs);
			if (!owner) return false;

			const proxy = owner.locationProxy;
			switch (op) {
				// a `Location` is an object, so these never assign
				case "||=":
				case "??=":
					return true;
				case "=":
				case "&&=":
					proxy.href = rhs;
					return true;
				case "+=":
					proxy.href = proxy.href + rhs;
					return true;
				default: {
					// the arithmetic ones, on the URL the page is meant to see: a number or NaN,
					// which navigates somewhere relative, the same as unproxied
					const apply = ARITHMETIC[op];
					if (!apply) return false;
					proxy.href = apply(proxy.href, rhs);
					return true;
				}
			}
		},
		writable: false,
		configurable: false,
	});
}
