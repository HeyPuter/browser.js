import { createState, stateListen, type Stateful } from "dreamland/core";

export class StatefulClass {
	ownedby: Set<StatefulClass> = null!;
	constructor() {
		const state = createState(Object.create(new.target.prototype));
		state.ownedby = new Set();
		return state;
	}

	autodirty() {
		let oldvalues: Map<any, any> = new Map();
		stateListen(this as Stateful<this>, (newvalue, prop) => {
			if (oldvalues.get(prop) === newvalue) return;
			this.markDirty(false);
			oldvalues.set(prop, newvalue);
		});
	}

	own(obj: StatefulClass) {
		obj.ownedby.add(this);
	}

	disown(obj: StatefulClass) {
		obj.ownedby.delete(this);
	}

	markDirty(urgent: boolean = false) {
		this.ownedby.forEach((obj) => obj.markDirty(urgent));
	}
}
