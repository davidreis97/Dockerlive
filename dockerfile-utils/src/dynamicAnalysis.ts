import {
	TextDocument, Range, Diagnostic, DiagnosticSeverity, CodeLens
} from 'vscode-languageserver-types';
import { Validator } from './dockerValidator';
import { ValidationCode } from './main';
import { Keyword, Dockerfile, Instruction } from 'dockerfile-ast';
import Dockerode from 'dockerode';
import uri2path = require('file-uri-to-path');
import path = require('path');
import fs, { write } from 'fs';
import tar from 'tar-fs';
import { Stream, Duplex } from 'stream';
import child_process from 'child_process';
import xml2js from 'xml2js';
import { table } from 'table';
import tar_stream from 'tar-stream';
import internal = require('stream');

var stripAnsi = require("strip-ansi");

export const DEBUG = false;
const MAX_ANALYSED_PROCESSES = 10;
const CHECK_PROCESSES_INTERVAL = 500; //ms

interface ContainerProcess {
	pid: number,
	ppid: number,
	cmd: string,
	children?: ContainerProcess[]
}

interface ExecData {
	output: Buffer,
	exitCode: number
}

export class DynamicAnalysis {
	public buildStream: Duplex;
	public document: TextDocument;
	public sendDiagnostics: Function;
	public sendProgress: Function;
	public sendPerformanceStats: Function;
	public sendCodeLenses: Function;
	public DA_problems: Map<string, Diagnostic>;
	public SA_problems: Diagnostic[];
	public dockerfile: Dockerfile;
	public docker: Dockerode;
	public container: any;
	public entrypointInstruction: Instruction;
	public codeLenses: CodeLens[];

	public checkProcessesInterval: NodeJS.Timeout;

	public isDestroyed: boolean = false;

	get containerName(): string {
		return 'testcontainer' + this.document.version;
	}

	constructor(document: TextDocument, sendDiagnostics: Function, sendProgress: Function, sendPerformanceStats: Function, sendCodeLenses: Function, SA_problems: Diagnostic[], dockerfile: Dockerfile, docker: Dockerode) {
		this.document = document;
		this.sendDiagnostics = sendDiagnostics;
		this.sendProgress = sendProgress;
		this.sendPerformanceStats = sendPerformanceStats;
		this.sendCodeLenses = sendCodeLenses;
		this.DA_problems = new Map();
		this.SA_problems = SA_problems;
		this.dockerfile = dockerfile;
		this.docker = docker;
		this.codeLenses = [];

		if (this.dockerfile.getENTRYPOINTs()[0] != null) {
			this.entrypointInstruction = this.dockerfile.getENTRYPOINTs()[0];
		} else if (this.dockerfile.getCMDs()[0] != null) {
			this.entrypointInstruction = this.dockerfile.getCMDs()[0];
		} else {
			this.entrypointInstruction = this.dockerfile.getInstructions()[this.dockerfile.getInstructions().length - 1];
		}

		sendDiagnostics(this.SA_problems);

		this.clearPreviousContainers().then((success) => { if (success) this.buildContainer() });
	}

	async clearPreviousContainers(): Promise<boolean> {
		return new Promise(async (res, _rej) => {
			this.docker.listContainers({ all: true }, async (err, containers) => {
				if (err) {
					this.log("Start Docker to enable dynamic analysis");
					res(false);
					return;
				}

				let removalPromises = [];

				for (let containerInfo of containers) {
					if (containerInfo.Names[0].match(/\/testcontainer.*/)) {
						removalPromises.push(this.docker.getContainer(containerInfo.Id).remove({ v: true, force: true }).catch((_e) => { }));
					}
				}

				await Promise.all(removalPromises);

				res(true);
			});
		})
	}

	publishCodeLenses() {
		if (this.isDestroyed) {
			return;
		}

		this.sendCodeLenses(this.codeLenses);
	}

	publishDiagnostics() {
		if (this.isDestroyed) {
			return;
		}

		let problems = Array.from(this.DA_problems.values());

		this.sendDiagnostics(this.document.uri, problems);
	}

	createDiagnostic(severity: DiagnosticSeverity, range: Range, message: string, code?: ValidationCode): Diagnostic {
		return Validator.createDockerliveDiagnostic(severity, range, message, code);
	}

	genKey(range: Range, identifier?: string): string {
		return `s${range.start.line}-${range.start.character}--e${range.end.line}-${range.end.character}-id${identifier}`;
	}

	getDiagnostic(range: Range, identifier?: string): Diagnostic {
		return this.DA_problems.get(this.genKey(range, identifier));
	}

	addDiagnostic(severity: DiagnosticSeverity, range: Range, message: string, identifier?: string, code?: ValidationCode) {
		if(!identifier){
			identifier = Math.round(Math.random() * 100000000).toString(); //If identifier is not specified, make sure that a unique identifier is generated
		}
		this.DA_problems.set(this.genKey(range, identifier), this.createDiagnostic(severity, range, message, code));
	}

	createCodeLens(range: Range, title: string, command?: string): CodeLens {
		return {
			range: range,
			command: {
				title: title,
				command: command || ""
			}
		};
	}

	addCodeLens(range: Range, title: string, command?: string) {
		this.codeLenses.push(this.createCodeLens(range, title, command));
	}

	buildContainer() {
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
								this.getImageHistory(intermediateImagesIDs);
								this.getFilesystem(intermediateImagesIDs[0]); // TODO - Remove
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


	getImageHistory(intermediateImagesIDs: string[]) {
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

	runContainer() {
		this.sendProgress("Creating container...");
		this.docker.createContainer({ Image: 'testimage', Tty: true, name: this.containerName, HostConfig: { PublishAllPorts: true } }, (err, container) => {
			this.container = container;

			if (this.isDestroyed) {
				this.sendProgress(true);
				return;
			}

			if (err) {
				this.debugLog("ERROR CREATING CONTAINER", err);
				this.addDiagnostic(DiagnosticSeverity.Error, this.entrypointInstruction.getRange(), "Error creating container - " + err);
				this.publishDiagnostics();
				this.sendProgress(true);
				return;
			}

			this.sendProgress("Starting container...");
			container.start((err, data) => {
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				if (err) {
					this.debugLog("ERROR STARTING CONTAINER", err);
					this.addDiagnostic(DiagnosticSeverity.Error, this.entrypointInstruction.getRange(), "Error starting container - " + err);
					this.publishDiagnostics();
					this.sendProgress(true);
					return;
				}
				this.log("STARTED CONTAINER", data);

				this.runServiceDiscovery();
				this.getPerformance();
				this.getOS();

				this.checkEnvVar();
				this.checkProcessesInterval = setInterval(this.checkEnvVar.bind(this), CHECK_PROCESSES_INTERVAL);

				container.wait((err, data) => {
					this.sendProgress(true);
					if (this.isDestroyed) {
						return;
					}
					if (err) {
						this.debugLog("ERROR GETTING CONTAINER EXIT CODE", err);
						return;
					}
					//this.log("CONTAINER CLOSED WITH CODE", data.StatusCode);
					if (data.StatusCode != 0) {
						this.addDiagnostic(DiagnosticSeverity.Error, this.entrypointInstruction.getRange(), "Container Exited with code (" + data.StatusCode + ") - See Logs");
						this.publishDiagnostics();
					}
					//this.destroy();
				});
			});

			container.logs({ follow: true, stdout: true, stderr: true }, (err, stream: Stream) => {
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				if (err) {
					this.debugLog("ERROR ATTACHING TO CONTAINER", err);
					this.addDiagnostic(DiagnosticSeverity.Error, this.entrypointInstruction.getRange(), "Error attaching to container - " + err);
					this.publishDiagnostics();
					this.sendProgress(true);
				}
				stream.on('data', (data) => {
					this.log(data);
				});
			});
		});
	}

	private async getRunningProcesses(): Promise<ContainerProcess[]> {
		if (this.isDestroyed) {
			return null;
		}
		let processList = await this.execWithStatusCode(["ps", "-eo", "pid,ppid,args"]);
		if (!processList || processList.exitCode != 0) {
			this.debugLog("Could not get running processes", processList ? processList.output.toString().replace(/[^\x20-\x7E|\n]/g, '') : "null");
			let DA_container_processes = this.getDiagnostic(this.entrypointInstruction.getArgumentsRange(), "container_processes");
			if (DA_container_processes)
				DA_container_processes.message = DA_container_processes.message.replace("Running Processes:", "Container Stopped. Last Processes:");
			this.publishDiagnostics();
			clearInterval(this.checkProcessesInterval);
			return null;
		}

		let processes: ContainerProcess[] = [];
		let tableData = [["PID", "PPID", "CMD"]];

		let sanitizedOutput = processList.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

		let psOutput = sanitizedOutput.split("\n").slice(1); //Remove bad characters, split by line and remove header line
		for (let line of psOutput) {
			if (line == "") continue;
			let splitLine = line.split(/\s+/);
			if (splitLine[3] == "ps") continue;

			processes.push({
				pid: parseInt(splitLine[1]),
				ppid: parseInt(splitLine[2]),
				cmd: splitLine.slice(3).join(" ")
			});

			tableData.push([splitLine[1], splitLine[2], splitLine.slice(3).join(" ")]);
		}

		this.addDiagnostic(DiagnosticSeverity.Hint, this.entrypointInstruction.getArgumentsRange(), table(tableData), "container_processes");

		this.publishDiagnostics();

		//Slightly modified from https://stackoverflow.com/a/40732240/6391820
		const createDataTree = (dataset: ContainerProcess[]): ContainerProcess[] => {
			let hashTable = Object.create(null)
			dataset.forEach(aData => hashTable[aData.pid] = { ...aData, children: [] })
			let dataTree = []
			dataset.forEach(aData => {
				if (aData.ppid) hashTable[aData.ppid].children.push(hashTable[aData.pid])
				else dataTree.push(hashTable[aData.pid])
			})
			return dataTree
		}

		return createDataTree(processes);
	}

	private async detectEnvChange(parsedEnvVars, process): Promise<any> {
		let envVar = await this.execWithStatusCode(["cat", `/proc/${process.pid}/environ`]);

		if (this.isDestroyed) {
			return;
		}

		if (!envVar || envVar.exitCode != 0) {
			this.debugLog("Could not verify envVars of command", process.cmd, envVar ? envVar.output.toString().replace(/[^\x20-\x7E|\n]/g, '') : "null");
			return null;
		}

		//Entries on file /proc/${pid}/environ are separated by the null character (0x00). Replacing to newline (0x0A).
		envVar.output = Buffer.from(envVar.output.map((value, _index, _arr) => value == 0x00 ? 0x0A : value));
		let sanitized = envVar.output.toString().replace(/[^\x20-\x7E|\n]/g, '').replace(/^\s*\n/gm, '');

		try {
			let actualEnvVars = parsePairs(sanitized);
			for (let key of Object.keys(actualEnvVars)) {
				if (parsedEnvVars[key] != null && parsedEnvVars[key].value != actualEnvVars[key]) {
					return {
						process: process,
						name: key,
						expectedValue: parsedEnvVars[key].value,
						actualValue: actualEnvVars[key],
						range: parsedEnvVars[key].range
					};
				}
			}
		} catch (e) {
			this.debugLog("Failed to parse env vars", sanitized);
			return;
		}
		return null;
	}

	private async checkEnvVar() {
		let envVarInsts = this.dockerfile.getENVs();
		let parsedEnvVars = {}

		for (let envVar of envVarInsts) {
			for (let property of envVar.getProperties()) {
				let name = property.getName();
				let value = property.getValue();

				if (value[0] == "$") { // value is a variable
					if (value[1] == "{") {
						value = value.slice(1, -1); //Remove initial '$' and final '}'
					}
					value = value.slice(1); //Remove initial '$' or '{'

					value = this.dockerfile.resolveVariable(value, property.getRange().end.line);
					if (!value) value = "";
				}

				parsedEnvVars[name] = {
					value: value,
					range: property.getRange()
				};
			}
		}

		let rootProcesses = await this.getRunningProcesses();

		if (this.isDestroyed || envVarInsts.length == 0) {
			return;
		}

		let maxAnalysedProcesses = MAX_ANALYSED_PROCESSES;

		let addedDiagnostic = false;

		let analyzeTree = async (processes, parentProcess) => {
			if (!processes || processes.length == 0) return;
			let envChangePromises = [];

			for (let process of processes) {
				if (maxAnalysedProcesses > 0) {
					envChangePromises.push(this.detectEnvChange(parsedEnvVars, process));
					maxAnalysedProcesses--;
				} else {
					break;
				}
			}

			let detectedEnvChanges = await Promise.all(envChangePromises);

			for (let change of detectedEnvChanges) {
				if (change == null) continue;
				else {
					let msg = `Detected modification to [${change.name}]\n` +
						`Expected: ${change.expectedValue}\n` +
						`Actual: ${change.actualValue}`;
					if (parentProcess != null) {
						msg += `\nChange occurred after executing: ${parentProcess.cmd}`;
					}
					if (!this.getDiagnostic(change.range)) {
						this.addDiagnostic(DiagnosticSeverity.Warning, change.range, msg, change.name);
						addedDiagnostic = true;
					}
				}
			}

			let childrenAnalysisPromises = [];

			if (this.isDestroyed) {
				return;
			}

			for (let [index, process] of processes.entries()) {
				if (maxAnalysedProcesses > 0 && detectedEnvChanges[index] == null) {
					childrenAnalysisPromises.push(analyzeTree(process.children, process));
				} else {
					break;
				}
			}

			await Promise.all(childrenAnalysisPromises);
		}

		await analyzeTree(rootProcesses, null);

		if (addedDiagnostic) {
			this.publishDiagnostics();
		}
	}

	private execWithStatusCode(cmd): Promise<ExecData> {
		return new Promise((res, _rej) => {
			this.container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, (err, exec) => {
				if (this.isDestroyed) {
					return;
				}

				if (err) {
					this.debugLog("ERROR CREATING EXEC", cmd, err);
					res(null);
					return;
				}

				let outputBuffers = [];

				exec.start((err, stream) => {
					if (this.isDestroyed) {
						return;
					}

					if (err) {
						this.debugLog("ERROR STARTING EXEC", cmd, err);
						res(null);
						return;
					}

					stream.on('data', async (data: Buffer) => {
						outputBuffers.push(data);
						await new Promise(r => setTimeout(r, 100)); //!- Temporary workaround. See stream.on('end')

						if (this.isDestroyed) {
							return;
						}

						exec.inspect((err, data) => {
							if (this.isDestroyed) {
								return;
							}

							if (err) {
								this.debugLog("ERROR INSPECTING EXEC", cmd, err);
								res(null);
								return;
							}

							if (!data.Running) {
								res({
									output: Buffer.concat(outputBuffers),
									exitCode: data.ExitCode
								});
							}
						});
					});

					//! - Due to a bug in Dockerode/Docker API, the end event is not being triggered, hence the necessity to inspect the exec every time data is received
					//! - https://github.com/apocas/dockerode/issues/534
					stream.on('end', () => {
						this.debugLog("EXEC END");
					})
				});
			});
		});
	}

	/*
		1st try - cat /etc/os-release
		2nd try - cat /etc/lsb-release
		3rd try - cat /etc/issue
		4th try - cat /proc/version
		5th try - uname

		If all fails, probably not a linux distribution
	*/
	private async getOS() {
		let fromInstruction = this.dockerfile.getFROMs()[0];

		let os_release = await this.execWithStatusCode(['cat', '/etc/os-release']);

		if (this.isDestroyed) {
			return;
		}

		if (os_release && os_release.exitCode == 0) {
			this.debugLog("Detected OS via", "os_release");

			/* //? If too overwhelming - display less information
			let diagMessage : string = "OS Information: \n\n";
			
			let parsedOSData = parsePairs(os_release.output);
			if(parsedOSData.PRETTY_NAME && parsedOSData.PRETTY_NAME != "Linux"){
				diagMessage += parsedOSData.PRETTY_NAME;
			}else{
				diagMessage += parsedOSData.NAME;
			}
			*/

			let diagMessage: string = "OS Information: \n\n" + os_release.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let lsb_release = await this.execWithStatusCode(['cat', '/etc/lsb-release']);

		if (this.isDestroyed) {
			return;
		}

		if (lsb_release && lsb_release.exitCode == 0) {
			this.debugLog("Detected OS via", "lsb-release");
			let diagMessage: string = "OS Information: \n\n" + lsb_release.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let issue = await this.execWithStatusCode(['cat', '/etc/issue']);

		if (this.isDestroyed) {
			return;
		}

		if (issue && issue.exitCode == 0) {
			this.debugLog("Detected OS via", "issue");
			let diagMessage: string = "OS Information: \n\n" + issue.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let version = await this.execWithStatusCode(['cat', '/proc/version']);

		if (this.isDestroyed) {
			return;
		}

		if (version && version.exitCode == 0) {
			this.debugLog("Detected OS via", "version");
			let diagMessage: string = "OS Information: \n\n" + version.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let uname = await this.execWithStatusCode(['uname']);

		if (this.isDestroyed) {
			return;
		}

		if (uname && uname.exitCode == 0) {
			this.debugLog("Detected OS via", "uname");
			let diagMessage: string = "OS Information: \n\n" + uname.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		//Probably not linux - generate diagnostic, return
		this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), "Not Linux");
		this.publishDiagnostics();
	}

	private runServiceDiscovery() {
		const rangesInFile: Range[] = [];
		const ports: number[] = [];
		const protocols: string[] = [];
		const mappedPorts: number[] = [];

		for (let instruction of this.dockerfile.getInstructions()) {
			if (instruction.getKeyword() == Keyword.EXPOSE) {
				instruction.getArguments().map((arg) => {
					if (arg.getValue().match(/\d+-\d+/)) { //E.g. 3000-3009
						let rangePorts: number[] = arg.getValue().split("-").map((value) => parseInt(value));
						for (let i = rangePorts[0]; i <= rangePorts[1]; i++) {
							rangesInFile.push(arg.getRange());
							ports.push(i);
							protocols.push("tcp"); //Ranged ports are always tcp
						}
					} else {
						const splitPortProtocol = arg.getValue().split("/");
						rangesInFile.push(arg.getRange());
						ports.push(parseInt(splitPortProtocol[0]));
						protocols.push(splitPortProtocol[1] ? splitPortProtocol[1] : "tcp"); //Default protocol is tcp
					}
				});
			}
		}

		if (ports.length == 0) { //No exposed ports
			return;
		}

		if (this.isDestroyed) {
			return;
		}

		this.container.inspect(async (err, data) => {
			if (this.isDestroyed || !data.State.Running) {
				this.sendProgress(true);
				return;
			}

			if (err) {
				this.debugLog("ERROR INSPECTING CONTAINER", err);
				this.sendProgress(true);
				return;
			}

			const mappings = data.NetworkSettings.Ports;
			for (let i = 0; i < rangesInFile.length; i++) {
				mappedPorts.push(parseInt(mappings[ports[i] + "/" + protocols[i]][0].HostPort));
			}

			let tcpMappedPorts = mappedPorts.filter((_value, index, _array) => protocols[index] == "tcp");

			await new Promise(r => setTimeout(r, 500)); //!- Waits 800ms - arbitrary measure

			this.sendProgress("Running nmap...");

			this.runNmap(tcpMappedPorts, mappedPorts, rangesInFile, ports);
		});
	}

	private runNmap(tcpMappedPorts, mappedPorts, rangesInFile, ports) {
		const nmapCommand = `nmap -oX - 127.0.0.1 -p ${tcpMappedPorts.join(",")} -sV --version-light`;

		this.debugLog("Running: " + nmapCommand);

		child_process.exec(nmapCommand, (err: child_process.ExecException, stdout: string, _stderr: string) => {
			if (this.isDestroyed) {
				this.sendProgress(true);
				return;
			}
			if (err) {
				this.debugLog("ERROR EXECUTING NMAP", err.message);
				this.sendProgress(true);
				return;
			}
			xml2js.parseString(stdout, (err: Error, result) => {
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				if (err) {
					this.debugLog("ERROR PARSING NMAP OUTPUT XML", err.message);
					this.sendProgress(true);
					return;
				}
				try {
					const nmapPorts: Array<any> = result['nmaprun']['host']['0']['ports']['0']['port'];
					for (const nmapPort of nmapPorts) {
						const portID = parseInt(nmapPort['$']['portid']);
						const protocol = nmapPort['$']['protocol'];

						const index = mappedPorts.findIndex((value, _index, _obj) => (value == portID));

						if (nmapPort['state']['0']['$']['state'] == "closed") {
							this.addDiagnostic(DiagnosticSeverity.Error, rangesInFile[index], `Port ${ports[index]} (exposed on ${portID}) - Could not detect service running yet`,portID.toString());
							continue;
						}

						let serviceName;
						let serviceProduct;
						let serviceExtrainfo;

						try{
							serviceName = nmapPort['service'][0]['$']['name'];
						}catch(_e){
							serviceName = "unknown"
						}

						try{
							serviceProduct = nmapPort['service'][0]['$']['product'];
						}catch(_e){}

						try{
							serviceExtrainfo = nmapPort['service'][0]['$']['extrainfo'];
						}catch(_e){}
						
						//? Assumes that when nmap can't identify the service there's nothing running there. 
						//? https://security.stackexchange.com/questions/23407/how-to-bypass-tcpwrapped-with-nmap-scan
						//? If this assumption is proven wrong, fallback on inspec to check if the port is listening
						if (serviceName == "tcpwrapped") {
							this.addDiagnostic(DiagnosticSeverity.Warning, rangesInFile[index], `Port ${ports[index]} (exposed on ${portID}) - Could not identify service running yet`,portID.toString());
						} else {
							let msg = `Port ${ports[index]} (exposed on ${portID}) - ${protocol}`;
							if (serviceName) {
								msg += "/" + serviceName;
							}
							if (serviceProduct) {
								msg += " - " + serviceProduct;
							}
							if (serviceExtrainfo) {
								msg += " (" + serviceExtrainfo + ")";
							}

							this.addDiagnostic(DiagnosticSeverity.Hint, rangesInFile[index], msg, portID.toString());
						}
					}
					this.publishDiagnostics();

					this.sendProgress(true); //! - Probably will need to change when implementing inspec / other feedback
				} catch (e) {
					this.debugLog("ERROR PARSING NMAP OUTPUT OBJECT", e, "WITH NMAP OUTPUT", JSON.stringify(result));
					this.sendProgress(true);
				}

				this.runNmap(tcpMappedPorts, mappedPorts, rangesInFile, ports);
			});
		})
	}

	//Based on https://github.com/moby/moby/blob/eb131c5383db8cac633919f82abad86c99bffbe5/cli/command/container/stats_helpers.go#L175-L188
	private calculateCPUPercent(stats) {
		try {
			let cpuPercent = 0;
			let cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
			let systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
			let cpuCount = stats.cpu_stats.cpu_usage.percpu_usage.length;

			if (systemDelta && cpuDelta) {
				cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100;
			}

			return !isNaN(cpuPercent) ? cpuPercent : 0;
		} catch (e) {
			return 0;
		}
	}

	private calculateNetworks(stats) {
		let rawNetworks = stats.networks;
		let finalNetworks = {};

		try {
			for (let key of Object.keys(rawNetworks)) {
				finalNetworks[key] = {
					input: rawNetworks[key].rx_bytes,
					output: rawNetworks[key].tx_bytes
				};
			}

			return finalNetworks;
		} catch (e) {
			return {};
		}
	}

	//Based on https://github.com/moby/moby/blob/eb131c5383db8cac633919f82abad86c99bffbe5/cli/command/container/stats_helpers.go#L106-L125
	private calculateStorage(stats) { //! TODO - Test a container which actually uses storage
		let readBytes = 0;
		let writeBytes = 0;

		try {
			if (process.platform === "win32") {
				readBytes = stats.storage_stats.read_size_bytes || 0;
				writeBytes = stats.storage_stats.write_size_bytes || 0;
			} else {
				for (let entry of stats.blkio_stats.io_service_bytes_recursive) {
					if (entry.op == "read") {
						readBytes += entry.value;
					} else if (entry.op == "write") {
						writeBytes += entry.value;
					}
				}
			}

			return {
				readBytes: !isNaN(readBytes) ? readBytes : 0,
				writeBytes: !isNaN(writeBytes) ? writeBytes : 0
			};
		} catch (e) {
			return {
				readBytes: 0,
				writeBytes: 0
			};
		}
	}

	private getPerformance() {
		if (this.isDestroyed) {
			return;
		}

		this.container.stats((err, stream: Stream) => {
			if (this.isDestroyed) {
				return;
			}

			if (err) {
				this.debugLog("ERROR GETTING CONTAINER STATS", err);
				return;
			}

			stream.on('data', (data: Buffer) => {
				if (this.isDestroyed) {
					return;
				}
				let parsedData = JSON.parse(data.toString());

				if (JSON.stringify(parsedData.memory_stats) === "{}") {
					return;
				}

				this.sendPerformanceStats({
					running: true,
					cpu: {
						percentage: this.calculateCPUPercent(parsedData)
					},
					memory: {
						usage: parsedData.memory_stats.usage || 0,
						limit: parsedData.memory_stats.limit || 0
					},
					networks: this.calculateNetworks(parsedData),
					storage: this.calculateStorage(parsedData)
				});
			});

			stream.on('end', () => {
				this.sendPerformanceStats({
					running: false
				});
			});
		});
	}

	extractTarStream(stream, entry_callback: Function, finish_callback?: Function){
		var extract = tar_stream.extract()
 
		extract.on('entry', (header, content_stream, next) => {
			entry_callback(header, content_stream, next);
			//content_stream.resume() // just auto drain the stream
		});
		
		if(finish_callback)
			extract.on('finish', ()=>{
				finish_callback();
			});

		stream.pipe(extract);
	}

	getFilesystem(imageID: string){
		let image = this.docker.getImage(imageID);

		image.get((err,stream) => {
			if(err){
				console.log("ERROR");
			}

			this.extractTarStream(stream, (header : tar_stream.Headers, content_stream: internal.PassThrough, nextLayer: Function) => {
				if(header.name.match(/\.tar$/)){
					console.log("Layer: " + header.name);
					this.extractTarStream(content_stream, (aufs_header : tar_stream.Headers, aufs_stream: internal.PassThrough, nextFile: Function) => {
						console.log("FILE: " + aufs_header.name);
						aufs_stream.on('end', () => {
							nextFile();
						});
						aufs_stream.resume();
					}, () => {
						nextLayer();
					})
				}else{
					nextLayer();
				}
			});
		})
	}

	restart(): DynamicAnalysis {
		this.destroy();
		return new DynamicAnalysis(this.document, this.sendDiagnostics, this.sendProgress, this.sendPerformanceStats, this.sendCodeLenses, this.SA_problems, this.dockerfile, this.docker);
	}

	destroy() {
		let DA_container_processes = this.getDiagnostic(this.entrypointInstruction.getArgumentsRange(), "container_processes");
		if (DA_container_processes)
			DA_container_processes.message = DA_container_processes.message.replace("Running Processes:", "Container Stopped. Last Processes:");

		this.publishDiagnostics();

		this.isDestroyed = true;

		this.debugLog("Destroying Analysis");

		this.sendProgress(true);

		if (this.buildStream) {
			try {
				this.buildStream.destroy();
				this.debugLog("Build Stream Terminated");
			} catch (e) {
				this.debugLog("Could not destroy build stream - " + e);
			}
		}

		if (this.container) {
			this.container.remove({ v: true, force: true }).catch((_e) => { });
			this.debugLog("Container Terminated");
		}

		if (this.checkProcessesInterval) {
			clearInterval(this.checkProcessesInterval);
		}
	}

	debugLog(...msgs: String[]) {
		if (DEBUG)
			this.log(...msgs);
	}

	log(...msgs: String[]) {
		if (DEBUG) {
			console.log("[" + this.document.version + "] " + msgs.map((msg, _i, _a) => stripAnsi(msg)).join(": "));
		} else {
			console.log(stripAnsi(msgs[msgs.length - 1].toString().replace(/\e\[[0-9;]*m(?:\e\[K)?/g, "")));
		}
	}
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

function parsePairs(str) {
	let obj = {};
	for (let line of str.split('\n')) {
		let splitLine = line.split("=");
		obj[splitLine[0]] = splitLine.slice(1).join("=");
	}
	return obj;
}
