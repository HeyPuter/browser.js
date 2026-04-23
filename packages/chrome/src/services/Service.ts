import { createState, createStore, type Stateful } from "dreamland/core";
import { StatefulClass } from "../util/StatefulClass";

export class Service extends StatefulClass {
	private dirty = false;

	override markDirty() {
		super.markDirty();
		this.dirty = true;
	}
}
