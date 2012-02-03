(function() {
	function ByteStream(buffer) {
		var a = new Uint8Array(buffer);
		var offset = 0;

		this.readString = function(l) {
	        var s = '';
	        for (var i = 0; i < l; i++) {
	            var c = this.readByte();
	            s += String.fromCharCode(c);
	        }
	        return s;
	    };

		this.readUnicodeCString = function() {
			var s = '';
			var c = this.readShort();
			while(c != 0) {
				s += String.fromCharCode(c);
				c = this.readShort();
			}
			return s;
		};

		this.readByte = function() {
	        var v = a[offset + 0];
	        offset += 1;
	        return v;
	    };

		this.skipByte = function(count) {
			if(count) {
				offset += count;
			} else {
				offset += 1;
			}
		};

		this.readShort = function() {
			var v = a[offset + 0] + (a[offset + 1] << 8);
			offset += 2;
			return v;
		};

		this.skipShort = function(count) {
			if(count) {
				offset += count * 2;
			} else {
				offset += 2;
			}
		};

		this.readLong = function() {
			var v = a[offset + 0] + (a[offset + 1] << 8) + (a[offset + 2] << 16) + (a[offset + 3] << 24);
			offset += 4;
			return v;
		};

		this.skipLong = function(count) {
			if(count) {
				offset += count * 4;
			} else {
				offset += 4;
			}
		};

		this.getOffset = function() {
			return offset;
		};

		this.seek = function(newOffset) {
			offset = newOffset;
		};
	}

	function PSG() {
		var clocksPerSample = false;
		var latched_channel, latched_volume;

		var channelVolume = Array(4);
		var channelFrequency = Array(4);
		var channelCounter = Array(4);
		var channelValue = Array(4);
		var whiteNoise;

		var noise_shift_register;
		var noise_feedback = 0x0009;
		var noise_shift_width = 16;

		// Volume table
		var volumes_raw = [ 1516,1205,957,760,603,479,381,303,240,191,152,120,96,76,60,0 ];
		var volumes = new Array(16);
		for(var i = 0; i < 16; i++) {
			volumes[i] = volumes_raw[i] / (16*1024);
		}

		this.reset = function(clock_rate, sample_rate) {
			clocksPerSample = (clock_rate / 16) / sample_rate;
			for(var i = 0; i < 4; i++) {
				channelVolume[i] = 15;
				channelFrequency[i] = 1;
				channelCounter[i] = 0;
				channelValue[i] = 1;
			}
			latched_channel = 0;
			latched_volume = false;
			whiteNoise = false;
			noise_shift_register = 0x8000;
		};

		this.configure = function(new_noise_feedback, new_noise_shift_width) {
			noise_feedback = new_noise_feedback;
			noise_shift_width = new_noise_shift_width;
		};
		
		this.write = function(data) {
			if(data & 0x80) {
				latched_channel = (data & 0x60) >> 5;
				latched_volume = ((data & 0x10) == 0x10);
				
				if(latched_volume) {
					channelVolume[latched_channel] = (data & 0x0F);
				} else if(latched_channel == 3) {
					whiteNoise = ((data & 0x04) == 0x04);
					channelFrequency[latched_channel] = 0x10 << (data & 0x03);
					noise_shift_register = 0x8000;
				} else {
					channelFrequency[latched_channel] = (channelFrequency[latched_channel] & 0x03F0) | (data & 0x000F);
				}
			} else {
				if(latched_volume) {
					// ???????
				} else if(latched_channel == 3) {
					// ?????????????
				} else {
					channelFrequency[latched_channel] = (channelFrequency[latched_channel] & 0x000F) | ((data & 0x003F) << 4);
				}
			}
		};

		// Emulates count samples into the buffer, starting at offset
		this.emulateSamples = function(buffer, offset, count, channelCount) {
			// Don't if we've not been reset yet
			if(!clocksPerSample) {
				return;
			}

			while(count > 0) {
				var sample = 0;

				// Update each tone channel
				for(var i = 0; i < 3; i++) {
					sample += volumes[channelVolume[i]] * channelValue[i];
					channelCounter[i] -= clocksPerSample;
					if(channelCounter[i] < 0) {
						channelCounter[i] += channelFrequency[i];
						if(channelFrequency[i] > 6) {
							channelValue[i] *= -1;
						}
					}
				}

				// Update the noise channel
				sample += 2 * volumes[channelVolume[3]] * (noise_shift_register & 0x01);
				channelCounter[3] -= clocksPerSample;
				if(channelCounter[3] < 0) {
					// Flip-flot
					channelValue[3] = -channelValue[3];
					if(channelFrequency[3] == 0x80) {
						channelCounter[3] += channelFrequency[2];
					} else {
						channelCounter[3] += channelFrequency[3];
					}
					
					// On the leading edge of the wave, do the noise calculations
					if(channelValue[i] == 1) {
						var feedback;
						if(whiteNoise) {
							feedback = noise_shift_register & noise_feedback;
							feedback ^= feedback >> 8;
							feedback ^= feedback >> 4;
							feedback ^= feedback >> 2;
							feedback ^= feedback >> 1;
							feedback &= 1;
						} else {
							feedback = noise_shift_register & 0x01;
						}
						noise_shift_register = (noise_shift_register >> 1) | (feedback << (noise_shift_width - 1));
					}
				}

				// Write the output sample
				buffer[offset] = sample;
				if(channelCount == 2) {
					buffer[offset + 1] = sample;
				}
				offset += channelCount;
				count -= 1;
			}
		};
	}

	function VgmFile() {
		var self = this;

		var isPlaying = false;

		var settings = {};
		var header;

		var psg = new PSG();

		self.outputSampleRate = 44100;
		self.playbackFactor = (48000 / 44100);

		this.onTagLoaded = function() { };

		function parse_tag() {
			var tagMagic = header.readString(4);
			if(tagMagic != 'Gd3 ') {
				return;
			}

			var tagVersion = header.readLong();
			if(tagVersion != 0x0100) {
				return;
			}
			header.skipLong();

			var tag = {
				en : { },
				ja : { }
			};

			tag.en.track = header.readUnicodeCString();
			tag.ja.track = header.readUnicodeCString();
			tag.en.game = header.readUnicodeCString();
			tag.ja.game = header.readUnicodeCString();
			tag.en.system = header.readUnicodeCString();
			tag.ja.system = header.readUnicodeCString();
			tag.en.author = header.readUnicodeCString();
			tag.ja.author = header.readUnicodeCString();
			tag.release = header.readUnicodeCString();
			tag.ripper = header.readUnicodeCString();
			tag.notes = header.readUnicodeCString();

			self.onTagLoaded(tag);
		}

		this.load = function(buffer) {
			header = new ByteStream(buffer);

			try {

			// Check the magic number
			var magic = header.readString(4);
			if(magic != "Vgm ") {
				console.log("Not a VGM file");
				return;
			}

			// Check the version number
			header.skipLong();
			var version = header.readLong();
			if(version > 0x0150) {
				console.log("Unknown VGM file version");
				return;
			}

			// Set the defaults (in case they're not specified in the header)
			settings = {
				frame_rate : 60,
				psg : {
					clock : 3579545,
					feedback : 0x0009,
					shift_width : 16
				}
			};

			// Read the core header fields for version 1.00
			var psg_clock = header.readLong();
			if(psg_clock > 0) {
				settings.psg.clock = psg_clock;
			}
			header.skipLong();
			var tag_offset = header.readLong();
			settings.sample_count = header.readLong();
			settings.loop_offset = header.readLong();
			settings.loop_samples = header.readLong();

			// Read the extra header fields for version 1.01
			if(version >= 0x0101) {
				settings.frame_rate = header.readLong();
			} else {
				header.skipLong();
			}

			// Read the extra header fields for version 1.10
			if(version >= 0x0110) {
				settings.psg.feedback = header.readShort();
				settings.psg.shift_width = header.readByte();
			} else {
				header.skipShort();
				header.skipByte();
			}
			header.skipByte();
			header.skipLong(2);

			// Read the extra header fields for version 1.50
			var data_offset = 0x40;
			if(version >= 0x0150) {
				var new_data_offset = header.readLong();
				if(new_data_offset > 0) {
					data_offset += 0x34 + new_data_offset;
				}
			}

			// Jump to the GD3 tag offset, if there is one
			if(tag_offset > 0) {
				header.seek(0x14 + tag_offset);
				parse_tag();
			}

			// Jump to the start of the data block
			header.seek(data_offset);

			// Reset the PSG
			psg.reset(settings.psg.clock, self.outputSampleRate);
			psg.configure(settings.psg.feedback, settings.psg.shift_width);

			// Configure playback rate
			self.playbackFactor = (self.outputSampleRate / 44100);

			// GO!
			isPlaying = true;
			
			} catch(e) {
				console.log(e);
			}
		}

		// Does the next command, whatever that is
		// Returns the number of samples to wait
		function nextCommand() {
			var command = header.readByte();

			// Short waits
			if((command & 0xF0) == 0x70) {
				return (command & 0x0F);
			}

			// Everything else
			switch(command) {
				case 0x4f:	// GameGear PSG stereo register
					header.skipByte();
					return 0;
				case 0x50:	// PSG
					psg.write(header.readByte());
					return 0;
				case 0x51:	// YM2413
					header.skipShort();
					return 0;
				case 0x52:	// YM2612 port 0
					header.skipShort();
					return 0;
				case 0x53:	// YM2612 port 1
					header.skipShort();
					return 0;
				case 0x54:	// YM2151
					header.skipShort();
					return 0;
				case 0x61:	// Wait a number of samples
					return header.readShort();
				case 0x62:	// Wait one frame (NTSC - 1/60th of a second)
					return 735;
				case 0x63:	// Wait one frame (PAL - 1/50th of a second)
					return 882;
				case 0x66:	// END
					console.log("STOPPED");
					isPlaying = false;
					return 0;
				case 0xe0: // Seek
					header.skipLong();
					return 0;
				default:
					if((command > 0x30) && (command <= 0x4e)) {
						header.skipByte();
					} else if((command > 0x55) && (command <= 0x5f)) {
						header.skipShort();
					} else if((command > 0xa0) && (command <= 0xbf)) {
						header.skipShort();
					} else if((command > 0xc0) && (command <= 0xdf)) {
						header.skipByte();
						header.skipShort();
					} else if((command > 0xe1) && (command <= 0xff)) {
						header.skipLong();
					}
					return 0;
			}
		}

		var samples_remaining = 0;

		this.fillSamples = function(audioBuffer, channelCount) {
			if(!isPlaying) {
				return;
			}

			var offset = 0;
			var buffer_remaining = Math.floor((audioBuffer.length - offset) / channelCount);

			while(buffer_remaining > 0) {
				// Emulate the pending samples
				var sample_count = Math.min(Math.ceil(samples_remaining), buffer_remaining);
				if(sample_count > 0) {
					psg.emulateSamples(audioBuffer, offset, sample_count, channelCount);
					samples_remaining -= sample_count;
					buffer_remaining -= sample_count;
					offset += (channelCount * sample_count);
				}

				// If we still have samples remaining, bail out
				if(samples_remaining > 0) {
					return;
				}

				// Next command
				samples_remaining += (nextCommand() * self.playbackFactor);

				if(!isPlaying) {
					// Stop immediately...
					samples_remaining = 0;
					return;
				}
			}
		};
	}

	window.VgmFile = VgmFile;
})();
