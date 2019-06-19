var results = new Map();
var baseUri;

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	if (request.xml) {
		baseUri = GetBaseUri(request.uri);
		ProcessSignatures(request.xml, sender.tab.id);
	}
	if (request.tab)
		sendResponse(results.get(request.tab));
});

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
	results.delete(tabId);
});

async function ProcessSignatures(xmlString, tabId) {
	var xml = XAdES.Parse(xmlString);
	var signatureNodes = XPathSelect(xml, "//ds:Signature[not(ancestor::ds:Signature)]");
	
	var allValid = true;
	var CheckSignature = async function(node) {
		var signature = {};

		signature.type = "Unknown signature type - an error occured";
		try {
			var signedXml = new XAdES.SignedXml(xml);
			signedXml.UriResolver = UriResolver;
			signedXml.LoadXml(node);
			await signedXml.Verify().then(x => {
				signature.valid = x;
				if (!x)
					allValid = false;

				// store signature type, additional references
				signature.references = [];
				signature.type = "Signature";
				signedXml.signature.SignedInfo.References.items.forEach(x => {
					if (x.Type == "http://uri.etsi.org/01903#SignedProperties") {
						// ignore - XAdES
					} else if (x.Type == "http://uri.etsi.org/01903#CountersignedSignature") {
						signature.type = "Countersignature";
					} else if (x.Uri == "" || x.Uri == "#xpointer(/)") {
						signature.type = "Document signature";
					} else if (x.Uri[0] == '#') {
						var id = x.Uri.substring(1);
						var nodes = XPathSelect(xml, `//*[@id='${id}' or @Id='${id}']`);
						if (nodes.length > 0 && nodes[0].localName == "SignatureValue" && nodes[0].namespaceURI == "http://www.w3.org/2000/09/xmldsig#")
							signature.type = "Countersignature";
						else
							signature.references.push(x.Uri);
					} else {
						signature.references.push(x.Uri);
					}
				});
				// store certificate info
				if (signature.valid) {
					var cert = GetCertificate(signedXml);
					if (cert != null) {
						signature.subjectInfo = GetSubjectInfo(cert.simpl);
						signature.serial = GetSerial(cert.simpl);
						signature.issuerInfo = GetIssuerInfo(cert.simpl);
					} else {
						signature.valid = false;
						signature.error = "No valid certificate found.";
						allValid = false;
					}
				}
				//await signedXml.VerifySigningCertificate().then(x => {
				//	signature.subjectInfo = GetSubjectInfo(x.simpl);
				//	signature.serial = GetSerial(x.simpl);
				//	signature.issuerInfo = GetIssuerInfo(x.simpl);
				//});
			}).catch(e => {
				signature.valid = false;
				signature.error = GetErrorMessage(e);
				allValid = false;
			});

			var counterSignatures = XPathSelect(node, "./ds:Object/xades:QualifyingProperties/xades:UnsignedProperties/xades:UnsignedSignatureProperties/xades:CounterSignature/ds:Signature");
			signature.signatures = await Promise.all(counterSignatures.map(node => CheckSignature(node)));
		} catch (e) {
			signature.error = GetErrorMessage(e);
			allValid = false;
		}
		return signature;
	};
	var signatures = await Promise.all(signatureNodes.map(node => CheckSignature(node)));

	if (signatures.length > 0) {
		chrome.browserAction.setIcon({ path: allValid ? "doc128tick.png" : "doc128cross.png", tabId: tabId });
		chrome.browserAction.setPopup({ popup: "popup.htm", tabId: tabId });
		results.set(tabId, signatures);
	}
};

function GetBaseUri(uri) {
	var path = uri.split('/');
	return path.slice(0, -1).join('/') + '/';
}

async function UriResolver(uri) {
	return await new Promise(function(resolve, reject) {
		var request = new XMLHttpRequest();
		request.addEventListener("load", () => resolve(request.responseText));
		request.addEventListener("error", () => resolve(null));
		request.open("GET", baseUri + uri);
		request.setRequestHeader("Cache-Control", "no-cache");
		request.send();
	});
}

function GetErrorMessage(error) {
	var idx = error.message.indexOf(" error: ");
	if (idx >= 0)
		return error.message.substring(idx + 8);
	if (error.message.startsWith(error.prefix)) {
		idx = error.message.indexOf(": ");
		if (idx >= 0)
			return error.message.substring(idx + 2);
	}
	return error.message;
}

function nsResolver(prefix) {
	return prefix == "ds" ? "http://www.w3.org/2000/09/xmldsig#" : prefix == "xades" ? "http://uri.etsi.org/01903/v1.3.2#" : null;
}

function XPathSelect(node, expression) {
	var evaluator = new XPathEvaluator();
	var result = evaluator.evaluate(expression, node, nsResolver, XPathResult.UNORDERED_NODE_ITERATOR_TYPE);
	var nodes = [];
	for (var node = result.iterateNext(); node; node = result.iterateNext())
		nodes.push(node);
	return nodes;
}

function GetCertificate(signedXml) {
	var keyInfo = signedXml.XmlSignature.KeyInfo;
	if (keyInfo.Count == 1) {
		var certs = keyInfo.Item(0).X509CertificateList;
		if (certs.length == 1)
			return certs[0];
	}
	return null;
}

function GetSubjectInfo(certificate) {
	var subjectInfo = GetDistinguishedNameInfo(certificate.subject);

	subjectInfo.Role = GetRole(certificate.extensions);
	subjectInfo.LEI = GetLEI(certificate.extensions);

	return subjectInfo;
}

function GetIssuerInfo(certificate) {
	return GetDistinguishedNameInfo(certificate.issuer);
}

function GetDistinguishedNameInfo(name) {
	var info = {};

	info.CN = GetDitinguishedNameElement(name, "2.5.4.3");
	info.SN = GetDitinguishedNameElement(name, "2.5.4.4");
	info.G = GetDitinguishedNameElement(name, "2.5.4.42");
	info.T = GetDitinguishedNameElement(name, "2.5.4.12");
	info.C = GetDitinguishedNameElement(name, "2.5.4.6");
	info.S = GetDitinguishedNameElement(name, "2.5.4.8");
	info.L = GetDitinguishedNameElement(name, "2.5.4.7");
	info.O = GetDitinguishedNameElement(name, "2.5.4.10");
	info.SERIAL = GetDitinguishedNameElement(name, "2.5.4.5");

	return info;
}

function GetDitinguishedNameElement(name, oid) {
	var element = name.typesAndValues.find(x => x.type == oid);
	return element ? element.value.valueBlock.value : null;
}

function GetLEI(extensions) {
	var leiExtension = extensions.find(x => x.extnID == "1.3.6.1.4.1.52266.1");
	if (!leiExtension)
		return null;
	var rawData = new Uint8Array(leiExtension.extnValue.valueBlock.valueHex);
	if (rawData[0] != 0xc && rawData[0] != 0x13)
		return null;
	return String.fromCharCode.apply(null, rawData.slice(2, 2  + rawData[1]));
}

function GetRole(extensions) {
	var roleExtension = extensions.find(x => x.extnID == "1.3.6.1.4.1.52266.2");
	if (!roleExtension)
		return null;
	var rawData = new Uint8Array(roleExtension.extnValue.valueBlock.valueHex);
	if (rawData[0] != 0xc && rawData[0] != 0x13)
		return null;
	return String.fromCharCode.apply(null, rawData.slice(2, 2  + rawData[1]));
}

function GetSerial(certificate) {
	return Array.from(new Uint8Array(certificate.serialNumber.valueBlock.valueHex), function(c) {
		return ('0' + c.toString(16)).slice(-2);
	}).join('');
}
