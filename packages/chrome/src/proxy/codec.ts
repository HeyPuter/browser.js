export const codecEncode = (url: string) => {
	if (!url) return url;

	return encodeURIComponent(url);
};

export const codecDecode = (url: string) => {
	if (!url) return url;

	return decodeURIComponent(url);
};
