/**
 * Everything the wasm-bindgen glue (`rewriter/wasm/out/wasm.js`) is allowed to
 * touch, and the only module it may import.
 *
 * The rewriter runs in the page's realm - every inline script, `eval` and
 * worker source goes through it - so the glue can't be left calling
 * `view.subarray(...)` or reading `memory.buffer`: those resolve through
 * prototypes the page shares with us and can overwrite. `subarray` alone is
 * enough to lose the rewriter, since it builds its result through the page-
 * writable `constructor` (species), letting a page hand back a view over a
 * buffer of its own and pick what source text wasm reads and what rewritten
 * text comes out.
 *
 * `tools/wbg/harden.mjs` rewrites the raw wasm-bindgen output onto these, and
 * `tools/wbg/eslint.config.mjs` then refuses the result if a single global,
 * prototype lookup or unvetted property read is left in it. So when a
 * wasm-bindgen update starts emitting something new, the build stops, and the
 * fix is a capture here plus an entry in harden.mjs's tables.
 *
 * Naming follows snapshot.ts: `Type_method(receiver, ...args)` is the
 * call-bound method, `Type_prop(receiver)` the call-bound getter.
 */
import * as snapshot from "../snapshot";

// Read once into module-level consts. A bundler turns each use of an import
// binding into a getter call on the exporting module's exports object, which
// costs ~15x in the helpers below that the glue calls per character or per
// string. (Reading a module namespace object can't reach the page.)
const {
	Crypto_getRandomValues,
	Error_prototype_toString,
	Function_prototype_call,
	Math_max,
	Math_min,
	Math_trunc,
	Number_toString,
	Object_defineProperty,
	Object_getOwnPropertyDescriptor,
	Object_getPrototypeOf,
	Object_hasOwn,
	String,
	String_charCodeAt,
	TypeError,
	TypedArray_prototype_byteLength,
} = snapshot;

export {
	Error,
	Function_call,
	Object_defineProperty,
	Reflect_apply,
	Reflect_get,
	Reflect_set,
	String_charCodeAt,
	String_slice,
	_TextDecoder,
	_TextEncoder,
	_URL,
	_Uint8Array,
	encodeURIComponent,
} from "../snapshot";

function uncurry(fn: (...args: any[]) => any) {
	return Function_prototype_call.bind(fn) as (
		receiver: unknown,
		...args: any[]
	) => any;
}

function getter(proto: object, name: string) {
	const get = Object_getOwnPropertyDescriptor(proto, name)?.get;
	if (!get) throw new TypeError(`wbg-snapshot: no getter for ${name}`);

	return Function_prototype_call.bind(get) as (receiver: unknown) => any;
}

// the constructor itself rather than snapshot's `_Uint8Array` proxy, which
// costs ~20x per construction for nothing: `new` reads only the
// constructor's own non-writable `prototype`
const Uint8Array_constructor = globalThis.Uint8Array;

const TypedArray_prototype = Object_getPrototypeOf(
	globalThis.Uint8Array.prototype
);

export const TypedArray_length = getter(TypedArray_prototype, "length") as (
	view: Uint8Array
) => number;
export const TypedArray_byteLength = Function_prototype_call.bind(
	TypedArray_prototype_byteLength
) as (view: Uint8Array) => number;
export const TypedArray_byteOffset = getter(
	TypedArray_prototype,
	"byteOffset"
) as (view: Uint8Array) => number;
export const TypedArray_buffer = getter(TypedArray_prototype, "buffer") as (
	view: Uint8Array
) => ArrayBufferLike;
// `set` from a typed-array or array-like source reads only the source's own
// elements (and its internal slots), with no species lookup
export const TypedArray_set = uncurry(TypedArray_prototype.set) as (
	view: Uint8Array,
	source: ArrayLike<number>,
	offset?: number
) => void;

/**
 * `%TypedArray%.prototype.subarray`, without the species lookup: the real one
 * builds its result with `new view.constructor(...)`, and `constructor` is a
 * writable property on `Uint8Array.prototype`. This constructs the view over
 * the same buffer directly. Only for `Uint8Array` (element size 1), which is
 * all the glue ever slices.
 */
export function Uint8Array_subarray(
	view: Uint8Array,
	begin: number,
	end?: number
): Uint8Array {
	const length = TypedArray_length(view);
	let from = Math_trunc(begin) || 0;
	from = from < 0 ? Math_max(length + from, 0) : Math_min(from, length);
	let to = end === undefined ? length : Math_trunc(end) || 0;
	to = to < 0 ? Math_max(length + to, 0) : Math_min(to, length);

	return new Uint8Array_constructor(
		TypedArray_buffer(view),
		TypedArray_byteOffset(view) + from,
		Math_max(to - from, 0)
	);
}

/**
 * `view[index]` and `view[index] = value`. A typed array answers every numeric
 * key itself - out-of-range reads are undefined, writes are dropped - and
 * never looks further up the chain, so these are safe as they stand; they
 * exist so the lint pass can ban computed member access without knowing which
 * receivers are typed arrays.
 */
export function Uint8Array_getIndex(view: Uint8Array, index: number): number {
	return view[index];
}
export function Uint8Array_setIndex(
	view: Uint8Array,
	index: number,
	value: number
): number {
	view[index] = value;
	return value;
}

export const _DataView = globalThis.DataView;
const DataView_prototype = globalThis.DataView.prototype;
export const DataView_buffer = getter(DataView_prototype, "buffer") as (
	view: DataView
) => ArrayBufferLike;
type DVGet<T> = (view: DataView, offset: number, littleEndian?: boolean) => T;
type DVSet<T> = (
	view: DataView,
	offset: number,
	value: T,
	littleEndian?: boolean
) => void;
export const DataView_getInt8 = uncurry(
	DataView_prototype.getInt8
) as DVGet<number>;
export const DataView_getUint8 = uncurry(
	DataView_prototype.getUint8
) as DVGet<number>;
export const DataView_getInt16 = uncurry(
	DataView_prototype.getInt16
) as DVGet<number>;
export const DataView_getUint16 = uncurry(
	DataView_prototype.getUint16
) as DVGet<number>;
export const DataView_getInt32 = uncurry(
	DataView_prototype.getInt32
) as DVGet<number>;
export const DataView_getUint32 = uncurry(
	DataView_prototype.getUint32
) as DVGet<number>;
export const DataView_getFloat32 = uncurry(
	DataView_prototype.getFloat32
) as DVGet<number>;
export const DataView_getFloat64 = uncurry(
	DataView_prototype.getFloat64
) as DVGet<number>;
export const DataView_getBigInt64 = uncurry(
	DataView_prototype.getBigInt64
) as DVGet<bigint>;
export const DataView_getBigUint64 = uncurry(
	DataView_prototype.getBigUint64
) as DVGet<bigint>;
export const DataView_setInt8 = uncurry(
	DataView_prototype.setInt8
) as DVSet<number>;
export const DataView_setUint8 = uncurry(
	DataView_prototype.setUint8
) as DVSet<number>;
export const DataView_setInt16 = uncurry(
	DataView_prototype.setInt16
) as DVSet<number>;
export const DataView_setUint16 = uncurry(
	DataView_prototype.setUint16
) as DVSet<number>;
export const DataView_setInt32 = uncurry(
	DataView_prototype.setInt32
) as DVSet<number>;
export const DataView_setUint32 = uncurry(
	DataView_prototype.setUint32
) as DVSet<number>;
export const DataView_setFloat32 = uncurry(
	DataView_prototype.setFloat32
) as DVSet<number>;
export const DataView_setFloat64 = uncurry(
	DataView_prototype.setFloat64
) as DVSet<number>;
export const DataView_setBigInt64 = uncurry(
	DataView_prototype.setBigInt64
) as DVSet<bigint>;
export const DataView_setBigUint64 = uncurry(
	DataView_prototype.setBigUint64
) as DVSet<bigint>;

// ES2024, and so absent from older engines. The glue already copes with
// `detached` reading as undefined, so this keeps that shape
const ArrayBuffer_prototype_detached = Object_getOwnPropertyDescriptor(
	globalThis.ArrayBuffer.prototype,
	"detached"
)?.get;
const ArrayBuffer_get_detached =
	ArrayBuffer_prototype_detached && uncurry(ArrayBuffer_prototype_detached);
export function ArrayBuffer_detached(
	buffer: ArrayBufferLike
): boolean | undefined {
	return ArrayBuffer_get_detached
		? ArrayBuffer_get_detached(buffer)
		: undefined;
}

const WebAssembly = globalThis.WebAssembly;
export const WebAssembly_Instance = WebAssembly.Instance;
export const Instance_exports = getter(
	WebAssembly.Instance.prototype,
	"exports"
) as (instance: WebAssembly.Instance) => WebAssembly.Exports;
export const Memory_buffer = getter(WebAssembly.Memory.prototype, "buffer") as (
	memory: WebAssembly.Memory
) => ArrayBuffer;
export const Memory_grow = uncurry(WebAssembly.Memory.prototype.grow) as (
	memory: WebAssembly.Memory,
	delta: number
) => number;
export const Table_length = getter(WebAssembly.Table.prototype, "length") as (
	table: WebAssembly.Table
) => number;
export const Table_get = uncurry(WebAssembly.Table.prototype.get) as (
	table: WebAssembly.Table,
	index: number
) => any;
export const Table_set = uncurry(WebAssembly.Table.prototype.set) as (
	table: WebAssembly.Table,
	index: number,
	value?: any
) => void;
export const Table_grow = uncurry(WebAssembly.Table.prototype.grow) as (
	table: WebAssembly.Table,
	delta: number,
	value?: any
) => number;

export const TextDecoder_decode = uncurry(
	globalThis.TextDecoder.prototype.decode
) as (decoder: TextDecoder, input?: AllowSharedBufferSource) => string;
export const TextEncoder_encode = uncurry(
	globalThis.TextEncoder.prototype.encode
) as (encoder: TextEncoder, input?: string) => Uint8Array;
// the result is a fresh ordinary object: its `read` and `written` are own data
// properties, which the glue reads through `Own_get`
export const TextEncoder_encodeInto = uncurry(
	globalThis.TextEncoder.prototype.encodeInto
) as (
	encoder: TextEncoder,
	source: string,
	destination: Uint8Array
) => TextEncoderEncodeIntoResult;

export const _FinalizationRegistry = globalThis.FinalizationRegistry;
export const FinalizationRegistry_register = uncurry(
	globalThis.FinalizationRegistry.prototype.register
) as (
	registry: FinalizationRegistry<any>,
	target: WeakKey,
	held: unknown,
	token?: WeakKey
) => void;
export const FinalizationRegistry_unregister = uncurry(
	globalThis.FinalizationRegistry.prototype.unregister
) as (registry: FinalizationRegistry<any>, token: WeakKey) => boolean;

const URL_prototype = globalThis.URL.prototype;
export const URL_href = getter(URL_prototype, "href") as (url: URL) => string;
export const URL_origin = getter(URL_prototype, "origin") as (
	url: URL
) => string;
export const URL_toString = uncurry(URL_prototype.toString) as (
	url: URL
) => string;

// undefined in engines without explicit resource management; the glue only
// installs the method when it is there
export const Symbol_dispose: typeof Symbol.dispose | undefined =
	globalThis.Symbol.dispose;

/**
 * A read of a property that is known to be an own data property: a string's
 * `length`, an array's `length` or index, a slot of a multi-value return, a
 * field of `encodeInto`'s result. Those reads never reach a prototype, but a
 * bare `x.length` can't say which of them `x` is, so the glue spells them
 * through this and the lint pass can ban member reads outright.
 *
 * Absent comes back `undefined` without walking the chain, and an accessor
 * throws rather than running.
 */
export function Own_get(object: unknown, key: PropertyKey): any {
	const descriptor = Object_getOwnPropertyDescriptor(object, key);
	if (descriptor === undefined) return undefined;
	// an accessor's descriptor has no own `value`, and reading one anyway
	// would fall through to `Object.prototype`
	if (!Object_hasOwn(descriptor, "value"))
		throw new TypeError(`wbg: '${String(key)}' is an accessor`);

	return descriptor.value;
}

/**
 * `s.length`, for a value the glue knows is a string. A primitive string's
 * `length` is its own, and nothing can redefine it; anything else goes through
 * Own_get. Separate from Own_get because the glue reads it for every string
 * it copies into wasm, and a descriptor per read showed up.
 */
export function String_length(value: string): number {
	return typeof value === "string" ? value.length : Own_get(value, "length");
}

/**
 * `array.push(value)` for an ordinary array, without [[Set]]: a store to a new
 * index walks the prototype chain for a setter, and `Array.prototype` is the
 * page's. Defining the index can't reach one.
 */
export function Array_append<T>(array: T[], value: T): number {
	const index = Own_get(array, "length") as number;
	Object_defineProperty(array, index, {
		__proto__: null,
		value,
		writable: true,
		enumerable: true,
		configurable: true,
	} as PropertyDescriptor);

	return index + 1;
}

/**
 * `array.slice()`. The real one creates its result through the page-writable
 * `constructor` (species) and reads each index with [[Get]].
 */
export function Array_copy<T>(array: T[]): T[] {
	const copy: T[] = [];
	const length = Own_get(array, "length") as number;
	for (let i = 0; i < length; i++) Array_append(copy, Own_get(array, i));

	return copy;
}

/**
 * wasm-bindgen spells every `.toString()` import as `arg0.toString()`, and the
 * JS side can't tell which Rust binding a given one came from. Here they are
 * `web_sys::Url::to_string` - always on a URL the glue itself constructed -
 * and `js_sys::Error::to_string`, on whatever a call threw.
 *
 * So: a URL takes `URL.prototype.toString`, found by brand (it throws on
 * anything else); any other object takes the generic
 * `Error.prototype.toString`, which reads `name` and `message` off it; a
 * primitive is converted with `String`, which consults no prototype.
 */
const Error_toString = uncurry(Error_prototype_toString) as (
	value: unknown
) => string;
export function Value_toString(value: unknown): string {
	if (
		value === null ||
		(typeof value !== "object" && typeof value !== "function")
	)
		return String(value);

	try {
		return URL_toString(value as URL);
	} catch {
		return Error_toString(value);
	}
}

// the `inline_js` snippet in rewriter/wasm/src/jsr.rs, which harden.mjs swaps
// for this. It is ungap's random-uuid over "10000000000": each 1/0/8 becomes a
// random hex digit, the 8 constrained to 8-b
const SCRAMTAG_TEMPLATE = "10000000000";
export function scramtag(): string {
	// one byte per digit, as the original draws, in one call rather than 11
	const random = Crypto_getRandomValues(
		new Uint8Array_constructor(SCRAMTAG_TEMPLATE.length)
	);
	let tag = "";
	for (let i = 0; i < SCRAMTAG_TEMPLATE.length; i++) {
		const c = String_charCodeAt(SCRAMTAG_TEMPLATE, i) - 48;
		tag += Number_toString(c ^ (random[i] & (15 >> (c / 4))), 16);
	}

	return tag;
}
