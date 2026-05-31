import { viteStaticCopy } from "vite-plugin-static-copy";

export default {
	plugins: [
		viteStaticCopy({
			targets: [
				{
					src: "node_modules/@mercuryworkshop/scramjet/dist/*",
					dest: "scramjet",
					rename: { stripBase: true },
				},
				{
					src: "node_modules/@mercuryworkshop/scramjet-controller/dist/*",
					dest: "controller",
					rename: { stripBase: true },
				},
			],
		}),
	],
};
