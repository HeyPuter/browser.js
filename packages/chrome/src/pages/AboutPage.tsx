import { css } from "dreamland/core";
import type { Tab } from "../Tab";
import { versionInfo } from "@mercuryworkshop/scramjet";

export function AboutPage(props: { tab: Tab }) {
	return (
		<div>
			<div class="main">
				<h1>Puter Browser</h1>
				Scramjet Version: {versionInfo.version} ({versionInfo.build})
			</div>
		</div>
	);
}
AboutPage.style = css`
	:scope {
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		font-family: sans-serif;
		background: var(--bg01);
		color: var(--fg);
	}

	.main {
		width: 70%;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.main {
		position: relative;
		top: 10em;
	}
`;
