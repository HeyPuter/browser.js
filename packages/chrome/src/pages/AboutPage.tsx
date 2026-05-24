import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { versionInfo } from "@mercuryworkshop/scramjet/bundled";

export function AboutPage(this: FC<{ tab: Tab }>) {
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
		background: var(--ntp_background);
		color: var(--ntp_text);
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
