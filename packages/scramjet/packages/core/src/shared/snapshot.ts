// this is a place for storing stateless globals that will be used by shared/
// this is NOT a place for putting dom apis

export const String = globalThis.String;
export const String_fromCodePoint = globalThis.String.fromCodePoint;
export const String_fromCharCode = globalThis.String.fromCharCode;

export const Object_keys = globalThis.Object.keys;
export const Object_values = globalThis.Object.values;
export const Object_entries = globalThis.Object.entries;
export const Object_hasOwn = globalThis.Object.hasOwn;
export const Object_getOwnPropertyNames = globalThis.Object.getOwnPropertyNames;
export const Object_getOwnPropertyDescriptor =
	globalThis.Object.getOwnPropertyDescriptor;
export const Object_getOwnPropertyDescriptors =
	globalThis.Object.getOwnPropertyDescriptors;
export const Object_getOwnPropertySymbols =
	globalThis.Object.getOwnPropertySymbols;

export const Array_from = globalThis.Array.from;
export const Array_isArray = globalThis.Array.isArray;
export const Array_of = globalThis.Array.of;

export const JSON_parse = globalThis.JSON.parse;
export const JSON_stringify = globalThis.JSON.stringify;

const textEncoder = new TextEncoder();
export const TextEncoder_encode = textEncoder.encode.bind(textEncoder);

const textDecoder = new TextDecoder();
export const TextDecoder_decode = textDecoder.decode.bind(textDecoder);

const performance = globalThis.performance;
export const Performance_now = performance.now.bind(performance);

export const btoa = globalThis.btoa;
export const atob = globalThis.atob;

export const Error = globalThis.Error;
export const Math_random = globalThis.Math.random;

export const _URL = makeWrap(globalThis.URL);
export const _Headers = makeWrap(globalThis.Headers);
export const _Date = makeWrap(globalThis.Date);
export const _URLSearchParams = makeWrap(globalThis.URLSearchParams);
export const _RegExp = makeWrap(globalThis.RegExp);

export function makeWrap<T extends object>(source: T): T {
	function getAllPropertyDescriptors(obj: object) {
		const descriptors: PropertyDescriptorMap = {};

		for (const key of Object.getOwnPropertyNames(obj)) {
			descriptors[key] = Object.getOwnPropertyDescriptor(obj, key)!;
		}
		for (const sym of Object.getOwnPropertySymbols(obj)) {
			descriptors[sym as any] = Object.getOwnPropertyDescriptor(obj, sym)!;
		}
		return descriptors;
	}

	// Recursively clone prototype chain
	function clonePrototypeChain(obj: object | null): object | null {
		if (obj === null) return null;
		const proto = Object.getPrototypeOf(obj);
		// The chain ends at null (root), otherwise recursively clone up the chain
		const clonedProto = clonePrototypeChain(proto);
		// Clone current object's own props and set prototype to cloned parent
		const clone = Object.create(clonedProto, getAllPropertyDescriptors(obj));
		return clone;
	}

	// Actually clone the source itself (including own properties)
	const wrapped = Object.create(
		clonePrototypeChain(Object.getPrototypeOf(source)),
		getAllPropertyDescriptors(source)
	);

	return wrapped as T;
}
