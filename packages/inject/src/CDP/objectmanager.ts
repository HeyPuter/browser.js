import { Protocol } from "devtools-protocol";
import { SkiBidiMap } from "./util";
import { box, CDPSession } from ".";
import { Array_isArray } from "../snapshot";

type ObjectId = string;
type RemoteObject = Protocol.Runtime.RemoteObject;
type ObjectType = `${Protocol.Runtime.RemoteObjectType}`;
type ObjectSubtype = `${Protocol.Runtime.RemoteObjectSubtype}`;

export class ObjectManager {
	constructor(public session: CDPSession) {}

	private objects = new SkiBidiMap<ObjectId, any>();

	private createId(): string {
		return Math.random().toString(16).slice(2);
	}

	private getOrCreateId(object: any): ObjectId {
		if (this.objects.getKey(object)) {
			return this.objects.getKey(object)!;
		} else {
			const id = this.createId();
			this.objects.set(id, object);
			return id;
		}
	}

	get(id: ObjectId): any {
		return this.objects.get(id);
	}

	wrap(object: any): RemoteObject {
		const klass = classify(object);
		const { type, subtype, className } = klass;
		const description = getDescription(object, klass);

		if (isPrimitive(type)) {
			return {
				type,
				description,
				value: object,
			};
		}

		const id = this.getOrCreateId(object);

		return {
			type,
			subtype,
			className,
			description,
			objectId: id,
		};
	}
}

function isPrimitive(type: ObjectType): boolean {
	return (
		type === "undefined" ||
		type === "string" ||
		type === "number" ||
		type === "boolean" ||
		type === "symbol" ||
		type === "bigint"
	);
}

export type ObjectClassification = {
	type: ObjectType;
	subtype?: ObjectSubtype;
	className?: string;
};
function classify(object: any): ObjectClassification {
	const type = typeof object;
	let subtype: ObjectSubtype | undefined;
	let className: string | undefined;

	if (type === "object") {
		if (object === null) {
			subtype = "null";
		} else if (Array_isArray(object)) {
			subtype = "array";
			className = "Array";
		} else if (box.instanceof(object, "RegExp")) {
			subtype = "regexp";
			className = "RegExp";
		} else if (box.instanceof(object, "Error")) {
			subtype = "error";
			className = "Error";
		} else if (box.instanceof(object, "Map")) {
			subtype = "map";
			className = "Map";
		} else if (box.instanceof(object, "Set")) {
			subtype = "set";
			className = "Set";
		} else if (box.instanceof(object, "Node")) {
			subtype = "node";
		}

		if (!className) {
			try {
				className = object?.constructor?.name;
			} catch {}
		}
	}
	if (type === "function") {
		className = "Function";
	}

	return { type, subtype, className };
}

function getDescription(object: any, klass?: ObjectClassification): string {
	const { type, subtype, className } = klass || classify(object);

	try {
		if (subtype === "null") return "null";
		if (type === "undefined") return "undefined";
		if (type === "string") return object;
		if (
			type === "number" ||
			type === "bigint" ||
			type === "boolean" ||
			type === "symbol" ||
			type === "function"
		) {
			return String(object);
		}

		if (subtype === "array") return `Array(${object.length})`;
		if (subtype === "map") return `Map(${object.size})`;
		if (subtype === "set") return `Set(${object.size})`;
		if (subtype === "regexp") return String(object);
		if (subtype === "error") return object.stack || String(object);
		if (subtype === "node") return object.nodeName || className || "Node";

		return className || type;
	} catch {
		return className || subtype || type;
	}
}
