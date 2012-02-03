(function() {
	"use strict";

	var Player = { };
	var currentPlaylist = false;
	var sink = false;
	var vgm = false;

	function playFile(index) {
		var filePath = "music/" + currentPlaylist[index];
		UtilFunctions.requestBinaryFile(filePath, function(data) {
			vgm = new VgmFile();
			vgm.outputSampleRate = sink.sampleRate;
			vgm.load(data);
		}, function() {
			alert("Can't load VGM file - " + filePath);
		})
	}

	function displayPlaylist(files) {
		var table = document.getElementById('playList');

		// Clear the table
		while (table.hasChildNodes()) {
			table.removeChild(table.firstChild);
		}

		// Insert the new playlist
		currentPlaylist.forEach(function(name, index) {
			var row = document.createElement('tr');
			var cell = document.createElement('td');
			var text = document.createTextNode(name.replace(/\.vgm$/, ''));
			cell.addEventListener('click', function() {
				playFile(index);
			});
			cell.appendChild(text);
			row.appendChild(cell);
			table.appendChild(row);
		});
	}

	function loadPlaylist(name) {
		// Display the screenshot
		// document.getElementById('gameScreenshot').src = "screenshots/" + name + ".png";

		// Load the playlist
		var playlistFile = "playlists/" + name + ".m3u";
		UtilFunctions.requestTextFile(playlistFile, function(data) {
			currentPlaylist = UtilFunctions.parsePlaylist(data);
			displayPlaylist(currentPlaylist);
		}, function() {
			alert("Can't load playlist - " + playlistFile);
		})
	}

	function displayGameList(files) {
		var table = document.getElementById('gameList');
		files.forEach(function(gameName) {
			var row = document.createElement('tr');
			var cell = document.createElement('td');
			var text = document.createTextNode(gameName);

			cell.addEventListener('click', function() {
				loadPlaylist(gameName);
			});

			cell.appendChild(text);
			row.appendChild(cell);
			table.appendChild(row);
		});
	}

	function fillBuffer(audioBuffer, channelCount) {
		// Skip if there's nothing to do
		if(vgm === false) {
			return;
		}
		vgm.fillSamples(audioBuffer, channelCount);
	}

	Player.loadGameList = function() {
		// Create the audio sink
		sink = new Sink(fillBuffer, 2, 44100, 44100);

		// Load the game list
		UtilFunctions.requestTextFile('games.txt', function(data) {
			displayGameList(UtilFunctions.parsePlaylist(data));
		}, function() {
			alert("Can't load game list - games.txt");
		});
	}

	window.Player = Player;
})();

window.addEventListener('DOMContentLoaded', function() {
	Player.loadGameList();
});
