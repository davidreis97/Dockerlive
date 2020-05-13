import { DynamicAnalysis } from './dynamicAnalysis';
import uri2path = require('file-uri-to-path');
import path = require('path');
import fs from 'fs';
import tar from 'tar-fs';
import { DiagnosticSeverity ,Range } from 'vscode-languageserver-types';
import { Duplex } from 'stream';

export function buildContainer(this: DynamicAnalysis) {
	let dockerfilePath: string;
	if (process.platform === "win32") {
		dockerfilePath = decodeURIComponent(uri2path(this.document.uri)).substr(1);
	} else {
		dockerfilePath = decodeURIComponent(uri2path(this.document.uri));
	}
	const directory = path.dirname(dockerfilePath);
	const tmpFileName = "tmp.Dockerfile"; //TODO - ADD TEMPORARY FILE TO VSCODE and GIT IGNORE (or simply move to a different directory)

	const tardir = tar.pack(directory);
	fs.writeFileSync(directory + "/" + tmpFileName, this.document.getText());

	this.docker.buildImage(tardir, { t: "testimage", dockerfile: tmpFileName, openStdin: true }, (error: string, stream: Duplex) => {
		this.buildStream = stream;
		let currentStep: number = 1;
		let timestamp = Date.now();
		let intermediateImagesIDs = new Array(this.dockerfile.getInstructions().length);

		if (error) {
			this.log(error);
			return;
		}

		if (this.isDestroyed) {
			return;
		}

		stream.on('end', () => {
			this.debugLog("End of Stream");
		});
		stream.on('error', (error: Buffer) => {
			this.log("Error", error.toString());
		});
		stream.on('data', (dataBuffer: Buffer) => {
			if (this.isDestroyed) {
				return;
			}

			const dataArray = dataBuffer.toString().split('\n');
			for (let data of dataArray) {
				try {
					const parsedData = JSON.parse(json_escape(data.toString()));
					if (parsedData["stream"]) {
						parsedData["stream"] = parsedData["stream"].replace(/(\n$|^\n)/g,"");
						if(parsedData["stream"] == ""){
							continue;
						}
						this.log("Stream", parsedData["stream"]);

						if (parsedData["stream"].match(/Step \d+\/\d+ :/)) {
							try {
								const tokenizedData: string[] = parsedData["stream"].split("/");
								currentStep = parseInt(tokenizedData[0].match(/\d+/)[0]);
								//const totalSteps = parseInt(tokenizedData[1].match(/\d+/)[0]);

								if (currentStep > 1) {
									const previousInstructionRange = this.dockerfile.getInstructions()[currentStep - 2].getRange();
									const currentTimeMs = Date.now();
									const timeDiference = (currentTimeMs - timestamp) / 1000;
									this.addCodeLens(previousInstructionRange, `${timeDiference.toFixed(3)}s`);
									timestamp = currentTimeMs;
									this.publishCodeLenses();
								}

								this.sendProgress(parsedData["stream"]);
							} catch (e) {
								this.log("Something went wrong parsing Docker build steps...");
							}
						} else if (parsedData["stream"].match(/(?<=---> )(\d|[a-f])+/g)) {
							intermediateImagesIDs[currentStep - 1] = parsedData["stream"].match(/(?<=---> )(\d|[a-f])+/g);
						}

						if (parsedData["stream"].match("Successfully built")) {
							this.DA_problems = new Map();
							this.publishDiagnostics();
							this.runContainer();
							const lastInstructionRange = this.dockerfile.getInstructions()[this.dockerfile.getInstructions().length - 1].getRange();
							const currentTimeMs = Date.now();
							const timeDiference = (currentTimeMs - timestamp) / 1000;
							this.addCodeLens(lastInstructionRange, `${timeDiference.toFixed(3)}s`);
							this.publishCodeLenses();
							this.getLayerData(intermediateImagesIDs);
							this.getFilesystem("testimage");
						}
					} else if (parsedData["status"]) {
						this.log("Status", parsedData["status"]);
					} else if (parsedData["errorDetail"]) {
						this.addDiagnostic(DiagnosticSeverity.Error, this.dockerfile.getInstructions()[currentStep - 1].getRange(), parsedData["errorDetail"]["message"]);
						this.publishDiagnostics();
						this.log("ErrorDetail", parsedData["errorDetail"]["message"]);
						this.sendProgress(true);
					} else {
						this.debugLog("Other", data.toString());
					}
				} catch (e) {
					if (data.toString()) {
						this.debugLog("Skipped build message", data.toString(), "Due to", e);
					}
				}
			}
		});
	});
}

export function getLayerData(this: DynamicAnalysis, intermediateImagesIDs: string[]) {
	this.docker.getImage("testimage").history((err, intermediateLayers) => {
		if (this.isDestroyed) {
			return;
		}

		if (err) {
			this.debugLog("Error getting image history", err);
		}

		for (let [intermediateImageIndex, imageID] of intermediateImagesIDs.entries()) {
			for (let [intermediateLayerIndex, layer] of intermediateLayers.entries()) {
				if (layer.Id !== "<missing>" && layer.Id.includes(`sha256:${imageID}`)) {
					let size: number = layer.Size;
					for (let tempIndex = intermediateLayerIndex + 1; tempIndex < intermediateLayers.length; tempIndex++) {
						if (intermediateLayers[tempIndex].Id === "<missing>") {
							size += intermediateLayers[tempIndex].Size;
						} else {
							break;
						}
					}
					let instructionRange: Range = this.dockerfile.getInstructions()[intermediateImageIndex].getRange();
					let unit = "B";
					if (size > 1000000000) {
						unit = "GB";
						size /= 1000000000;
					} else if (size > 1000000) {
						unit = "MB";
						size /= 1000000;
					} else if (size > 1000) {
						unit = "KB";
						size /= 1000;
					}
					this.addCodeLens(instructionRange, size.toFixed(2) + unit);

					break;
				}
			}
		}

		this.publishCodeLenses();
	});
}

function json_escape(str: string) {
	return str.replace(/\\n/g, "\\n")
		.replace(/\\'/g, "\\'")
		.replace(/\\"/g, '\\"')
		.replace(/\\&/g, "\\&")
		.replace(/\\r/g, "\\r")
		.replace(/\\t/g, "\\t")
		.replace(/\\b/g, "\\b")
		.replace(/\\f/g, "\\f")
		.replace(/[\u0000-\u0019]+/g, "");
}