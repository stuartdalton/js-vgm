(function() {
	"use strict";

	var UtilFunctions = {};

	function doRequest(url, type, onSuccess, onFailure) {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', url, true);
		xhr.responseType = type;
		xhr.onreadystatechange = function() {
			if(xhr.readyState !== 4) {
				return;
			}
			if((xhr.status == 0) || (xhr.status == 200)) {
				onSuccess(xhr.response);
			} else {
				onFailure();
			}
		}
		xhr.send(null);
	}

	UtilFunctions.requestTextFile = function(url, onSuccess, onFailure) {
		doRequest(url, 'text', onSuccess, onFailure);
	}

	UtilFunctions.parsePlaylist = function(text) {
		return text.split('\n').filter(function(e) {
			return (e.length > 0);
		}).map(function(e) {
			return e.trim();
		});
	}

	UtilFunctions.requestBinaryFile = function(url, onSuccess, onFailure) {
		doRequest(url, 'arraybuffer', onSuccess, onFailure);
	}

	window.UtilFunctions = UtilFunctions;
})();
