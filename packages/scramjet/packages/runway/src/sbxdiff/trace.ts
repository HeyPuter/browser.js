/**
 * Decoder for sbxdiff trace files (`.sbxd`).
 *
 * The wire format is produced by
 * `third_party/blink/renderer/platform/bindings/sbxdiff/sbx_tracer.cc` and
 * specified in `docs/sbxdiff/ARCHITECTURE.md`. `tools/sbxdiff/sbxread.py` is the
 * reference decoder; this one exists so the differ can stay in one process and
 * one type system.
 *
 * Nothing here may assume a trace is well-formed past its last complete record:
 * the tracer flushes at task boundaries and the process can be killed mid-run,
 * so a truncated tail is normal, not corruption.
 */

// Plain objects rather than `enum`: runway runs under Node's
// --experimental-strip-types, which erases types but cannot emit the runtime
// object an enum needs.
export const Kind = {
	Intern: 0,
	BindingCall: 1,
	Interceptor: 2,
	Realm: 3,
	InterceptorOutcome: 4,
	NetRequest: 5,
	Exception: 6,
	Script: 7,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const Tag = {
	Undefined: 0,
	Null: 1,
	Bool: 2,
	Number: 3,
	String: 4,
	BigInt: 5,
	Symbol: 6,
	Object: 7,
	DomWrapper: 8,
	Function: 9,
	Proxy: 10,
	Opaque: 11,
} as const;
export type Tag = (typeof Tag)[keyof typeof Tag];

export type Value =
	| { t: typeof Tag.Undefined }
	| { t: typeof Tag.Null }
	| { t: typeof Tag.Bool; v: boolean }
	| { t: typeof Tag.Number; v: number }
	/** `len` is the true UTF-8 length; `s` is truncated to 512 bytes. */
	| { t: typeof Tag.String; len: number; s: string; truncated: boolean }
	| { t: typeof Tag.BigInt }
	| { t: typeof Tag.Symbol }
	| { t: typeof Tag.Object; id: number }
	| { t: typeof Tag.DomWrapper; id: number; iface: string }
	| { t: typeof Tag.Function; id: number }
	| { t: typeof Tag.Proxy; id: number }
	| { t: typeof Tag.Opaque };

export type BindingCall = {
	kind: typeof Kind.BindingCall;
	level: number;
	seq: number;
	realm: number;
	task: number;
	name: string;
	threw: boolean;
	/** V8 script id of the frame on top of the stack; 0 = no JS on the stack. */
	topScript: number;
	/** Script that entered the task this record belongs to. */
	entryScript: number;
	recv: Value;
	result: Value;
	argcTotal: number;
	args: Value[];
};

export type Interceptor = {
	kind: typeof Kind.Interceptor;
	level: number;
	seq: number;
	realm: number;
	task: number;
	name: string;
	topScript: number;
	entryScript: number;
	keyKind: 0 | 1 | 2;
	recv: Value;
	key?: Value;
	index?: number;
	written?: Value;
	/** Filled in from the following kInterceptorOutcome record, if present. */
	intercepted?: boolean;
};

export type NetRequest = {
	kind: typeof Kind.NetRequest;
	seq: number;
	task: number;
	method: string;
	url: string;
	blocked: boolean;
};

export type Exception = {
	kind: typeof Kind.Exception;
	seq: number;
	task: number;
	code: number;
	message: string;
};

export type Record_ = BindingCall | Interceptor | NetRequest | Exception;

export type Trace = {
	file: string;
	version: number;
	pid: number;
	runKey: number;
	/**
	 * realm id -> creation time in microseconds, on a clock comparable across
	 * trace files and processes. Empty for a v3 trace.
	 */
	realmCreatedUs: Map<number, number>;
	/** realm id -> URL, from kRealm records. */
	realms: Map<number, string>;
	/** V8 script id -> script URL, from kScript records. */
	scripts: Map<number, string>;
	records: Record_[];
	/** Bytes after the last complete record. Nonzero is normal (see above). */
	truncatedBytes: number;
};

class Reader {
	private p = 0;
	private readonly b: Buffer;
	constructor(b: Buffer) {
		this.b = b;
	}

	get pos() {
		return this.p;
	}
	get eof() {
		return this.p >= this.b.length;
	}

	u8(): number {
		if (this.p >= this.b.length) throw new RangeError("eof");
		return this.b[this.p++];
	}

	varint(): number {
		let shift = 0;
		let out = 0;
		for (;;) {
			const byte = this.u8();
			// Beyond 2^53 a JS number cannot hold the value exactly. Object ids
			// and seqs never get near it; IEEE-754 number bits do, so those are
			// read with `varintBig`.
			out += (byte & 0x7f) * Math.pow(2, shift);
			if ((byte & 0x80) === 0) return out;
			shift += 7;
			if (shift > 63) throw new RangeError("varint too long");
		}
	}

	varintBig(): bigint {
		let shift = 0n;
		let out = 0n;
		for (;;) {
			const byte = this.u8();
			out |= BigInt(byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) return out;
			shift += 7n;
			if (shift > 63n) throw new RangeError("varint too long");
		}
	}

	bytes(n: number): Buffer {
		if (this.p + n > this.b.length) throw new RangeError("eof");
		const out = this.b.subarray(this.p, this.p + n);
		this.p += n;
		return out;
	}
}

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

export function decode(file: string, buf: Buffer): Trace {
	const r = new Reader(buf);
	const magic = r.bytes(4).toString("latin1");
	if (magic !== "SBXD") throw new Error(`${file}: not an sbxd trace`);
	const version = r.varint();
	const pid = r.varint();
	const runKey = r.varint();

	const names = new Map<number, string>();
	const realms = new Map<number, string>();
	const realmCreatedUs = new Map<number, number>();
	const scripts = new Map<number, string>();
	const records: Record_[] = [];
	/** seq -> index into `records`, so an outcome can annotate its target. */
	const bySeq = new Map<number, number>();

	const name = (id: number) => names.get(id) ?? `<unknown:${id}>`;

	const value = (): Value => {
		const t = r.u8() as Tag;
		switch (t) {
			case Tag.Undefined:
				return { t };
			case Tag.Null:
				return { t };
			case Tag.Bool:
				return { t, v: r.u8() !== 0 };
			case Tag.Number: {
				u64[0] = r.varintBig();
				return { t, v: f64[0] };
			}
			case Tag.String: {
				const len = r.varint();
				const emit = r.varint();
				const s = emit > 0 ? r.bytes(emit).toString("utf8") : "";
				return { t, len, s, truncated: emit < len };
			}
			case Tag.BigInt:
			case Tag.Symbol:
			case Tag.Opaque:
				return { t };
			case Tag.DomWrapper: {
				const id = r.varint();
				return { t, id, iface: name(r.varint()) };
			}
			case Tag.Object:
			case Tag.Function:
			case Tag.Proxy:
				return { t, id: r.varint() };
			default:
				throw new Error(`bad value tag ${t}`);
		}
	};

	let good = r.pos;
	try {
		while (!r.eof) {
			const kind = r.varint() as Kind;
			switch (kind) {
				case Kind.Intern: {
					const id = r.varint();
					names.set(id, r.bytes(r.varint()).toString("utf8"));
					break;
				}
				case Kind.BindingCall: {
					const level = r.u8();
					const seq = r.varint();
					const realm = r.varint();
					const task = r.varint();
					const topScript = r.varint();
					const entryScript = r.varint();
					const nameId = r.varint();
					const threw = r.u8() !== 0;
					const recv = value();
					const result = value();
					const argcTotal = r.varint();
					const argc = r.varint();
					const args: Value[] = [];
					for (let i = 0; i < argc; i++) args.push(value());
					bySeq.set(seq, records.length);
					records.push({
						kind,
						level,
						seq,
						realm,
						task,
						name: name(nameId),
						threw,
						topScript,
						entryScript,
						recv,
						result,
						argcTotal,
						args,
					});
					break;
				}
				case Kind.Interceptor: {
					const level = r.u8();
					const seq = r.varint();
					const realm = r.varint();
					const task = r.varint();
					const topScript = r.varint();
					const entryScript = r.varint();
					const nameId = r.varint();
					const keyKind = r.u8() as 0 | 1 | 2;
					const recv = value();
					const rec: Interceptor = {
						kind,
						level,
						seq,
						realm,
						task,
						name: name(nameId),
						topScript,
						entryScript,
						keyKind,
						recv,
					};
					if (keyKind === 0) rec.key = value();
					else if (keyKind === 1) rec.index = r.varint();
					// key_kind 2 (enumerator / IndexOf / IterableToList) writes
					// no has_value byte at all -- not a zero byte, nothing. It
					// is the one record shape that ends after the receiver.
					if (keyKind !== 2 && r.u8() !== 0) rec.written = value();
					bySeq.set(seq, records.length);
					records.push(rec);
					break;
				}
				case Kind.Realm: {
					r.varint(); // seq -- realm records are not compared
					const realm = r.varint();
					realms.set(realm, r.bytes(r.varint()).toString("utf8"));
					// v4: when the realm was created, on a clock comparable across
					// trace FILES. `seq` is not: it counts records within one file,
					// so two realms in different files both start at 1 and any rule
					// that orders them by it is a coin flip.
					if (version >= 4) realmCreatedUs.set(realm, r.varint());
					break;
				}
				case Kind.InterceptorOutcome: {
					const target = r.varint();
					const intercepted = r.u8() !== 0;
					const at = bySeq.get(target);
					if (at !== undefined) {
						const rec = records[at];
						if (rec.kind === Kind.Interceptor) rec.intercepted = intercepted;
					}
					break;
				}
				case Kind.NetRequest: {
					const seq = r.varint();
					const task = r.varint();
					const blocked = r.u8() !== 0;
					const method = r.bytes(r.varint()).toString("utf8");
					const url = r.bytes(r.varint()).toString("utf8");
					records.push({ kind, seq, task, method, url, blocked });
					break;
				}
				case Kind.Script: {
					const id = r.varint();
					scripts.set(id, r.bytes(r.varint()).toString("utf8"));
					break;
				}
				case Kind.Exception: {
					const seq = r.varint();
					const task = r.varint();
					const code = r.varint();
					r.varint(); // true message length
					const emit = r.varint();
					const message = emit > 0 ? r.bytes(emit).toString("utf8") : "";
					records.push({ kind, seq, task, code, message });
					break;
				}
				default:
					throw new Error(`bad record kind ${kind}`);
			}
			good = r.pos;
		}
	} catch (e) {
		// Truncated tail: keep everything decoded so far. Rethrow anything that
		// is not a short read, since that means the format drifted.
		if (!(e instanceof RangeError)) throw e;
	}

	return {
		file,
		version,
		pid,
		runKey,
		realms,
		realmCreatedUs,
		scripts,
		records,
		truncatedBytes: buf.length - good,
	};
}
