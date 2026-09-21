import { StatefulClass } from "../util/StatefulClass";

export abstract class Service extends StatefulClass {
	dirty = false;
	abstract save(): unknown;

	override markDirty() {
		super.markDirty();
		this.dirty = true;
	}
}
