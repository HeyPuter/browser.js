import { css } from "dreamland/core";
import type { Tab } from "../Tab";

// import { editor } from "monaco-editor";

// const Editor: Component<
// 	{
// 		language: string;
// 	},
// 	{
// 		editor: editor.IStandaloneCodeEditor;
// 	}
// > = function (cx) {
// 	cx.mount = () => {
// 		this.editor = editor.create(cx.root, {
// 			language: this.language,
// 			automaticLayout: true,
// 		});
// 	};

// 	return <div></div>;
// };
// Editor.style = css`
// 	:scope {
// 		width: 100%;
// 		height: 100%;
// 	}
// `;

export function PlaygroundPage(s: { tab: Tab }) {
	return (
		<div>
			<h1>Scramjet Playground</h1>
			{/*<Editor language="html"></Editor>*/}
		</div>
	);
}
PlaygroundPage.style = css`
	:scope {
		width: 100%;
		height: 100%;
	}
`;
