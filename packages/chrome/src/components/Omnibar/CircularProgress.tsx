import { css, type ComponentContext } from "dreamland/core";

export function CircularProgress(
	s: {
		progress: number;
		size?: string;
		strokeWidth?: string;
		color?: string;
	},
	cx: ComponentContext
) {
	const radius = 100;
	const circumference = 2 * Math.PI * radius;

	use(s.progress).listen((p) => {
		if (p == 0) {
			cx.root.classList.remove("visible");
		} else {
			cx.root.classList.add("visible");

			cx.root
				.querySelector("circle.moving")!
				.setAttribute("stroke-dashoffset", circumference * (1 - p) + "px");
		}
	});

	return (
		<svg
			width="200"
			height="200"
			viewBox="0 0 200 200"
			version="1.1"
			xmlns="http://www.w3.org/2000/svg"
			style="transform:rotate(-90deg)"
		>
			<circle
				r="90"
				cx="100"
				cy="100"
				class="inactive"
				stroke-width="16px"
				stroke-linecap="round"
				stroke-dashoffset="0px"
				fill="transparent"
				stroke-dasharray="565.48px"
			></circle>
			<circle
				r="90"
				cx="100"
				cy="100"
				class="moving"
				stroke-width="16px"
				stroke-linecap="round"
				stroke-dashoffset="118.692px"
				fill="transparent"
				stroke-dasharray="565.48px"
			></circle>
		</svg>
	);
}
CircularProgress.style = css`
	:scope {
		pointer-events: none;
		position: absolute;
		top: 2px;
		left: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		transition: opacity 0.2s ease;
		transform: rotate(-90deg);
	}
	:scope.visible {
		opacity: 1;
	}
	circle {
		fill: transparent;
		stroke: var(--accent);
		/*transition: stroke-dashoffset 0.2s ease;*/
	}
	circle.inactive {
		stroke: var(--bg20);
	}
`;
