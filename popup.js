chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
	chrome.runtime.sendMessage({ tab: tabs[0].id }, function(response) {
		var signatures = response;

		var CreateDiv = function(signature) {
			var result = [];
			result.push(`<div class="signature"><img src="${signature.valid ? "tick" : "cross"}.png" /><span class="type">${signature.type}</span>`);
			if (signature.references && signature.references.length > 0) {
				result.push('<p class="header">Signed references:</p><ul>');
				signature.references.forEach(x => {
					result.push(`<li>${x}</li>`);
				});
				result.push("</ul>");
			}

			if (signature.error)
				result.push(`<p class="error">${signature.error}</p>`);

			if (signature.subjectInfo) {
				result.push('<p class="header">Signed by:</p>');
				var s = Concat(', ', signature.subjectInfo.CN || Concat(' ', signature.subjectInfo.G, signature.subjectInfo.SN), signature.subjectInfo.Role || signature.subjectInfo.T);
				if (s)
					result.push(`<span>${s}</span>`);
				if (signature.subjectInfo.O)
					result.push(`<span>${signature.subjectInfo.O}</span>`);
				s = Concat(', ', signature.subjectInfo.L, signature.subjectInfo.S, signature.subjectInfo.C);
				if (s)
					result.push(`<span>${s}</span>`);
				if (signature.subjectInfo.LEI)
					result.push(`<span>LEI: <a href="https://search.gleif.org/#/record/${signature.subjectInfo.LEI}" target="_blank">${signature.subjectInfo.LEI}</a></span>`);
			}
			if (signature.serial)
				result.push(`<p class="header">Serial number: ${signature.serial.toUpperCase()}</p>`);

			if (signature.issuerInfo) {
				result.push('<p class="header">Certificate issued by:</p>');
				var s = Concat(', ', signature.issuerInfo.CN, signature.issuerInfo.O);
				if (s)
					result.push(`<span>${s}</span>`);
				s = Concat(', ', signature.issuerInfo.L, signature.issuerInfo.S, signature.issuerInfo.C);
				if (s)
					result.push(`<span>${s}</span>`);
			}

			if (signature.signatures && signature.signatures.length > 0) {
				result.push('<p class="header">Countersignatures:</p>');
				signature.signatures.forEach(x => {
					result.push(CreateDiv(x));
				});
			}
			result.push("</div>");
			return result.join('');
		}
		document.body.innerHTML = signatures.map(x => CreateDiv(x)).join('');
	});
});

function Concat(separator, ...args) {
	return args.filter(x => x).join(separator);
}
