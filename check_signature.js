if (document.getElementsByTagName("Signature").length > 0) {
	var request = new XMLHttpRequest();
	request.addEventListener("load", () => ProcessSignatures(request.responseText));
	request.open("GET", document.location.href);
	request.send();
}

function ProcessSignatures(s) {
	chrome.runtime.sendMessage({ xml: s, uri: document.location.href });
}
