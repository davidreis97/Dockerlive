import {
	TextDocument, Range, Position, Diagnostic, DiagnosticSeverity
} from 'vscode-languageserver-types';
import { Validator } from './dockerValidator';
import { ValidationCode } from './main';
import { Instruction, Keyword, Dockerfile } from 'dockerfile-ast';
import Dockerode from 'dockerode';
import uri2path = require('file-uri-to-path');
import path = require('path');
import fs, { write } from 'fs';
import tar from 'tar-fs';
import { Stream, Duplex } from 'stream';
import child_process from 'child_process';
import xml2js from 'xml2js';
import parsePairs from "parse-pairs";
const stripAnsi = require('strip-ansi');

export const DEBUG = true;

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
	public DA_problems: Diagnostic[];
	public SA_problems: Diagnostic[];
	public dockerfile: Dockerfile;
	public docker: Dockerode;
	public container: any;

	public isDestroyed: boolean = false;

	public readonly performanceUpdateFrequency: number = 100000;
	public performanceTimeout: NodeJS.Timeout;

	constructor(document: TextDocument, sendDiagnostics: Function, sendProgress: Function, sendPerformanceStats: Function, SA_problems: Diagnostic[], dockerfile: Dockerfile, docker: Dockerode) {
		this.document = document;
		this.sendDiagnostics = sendDiagnostics;
		this.sendProgress = sendProgress;
		this.sendPerformanceStats = sendPerformanceStats;
		this.DA_problems = [];
		this.SA_problems = SA_problems;
		this.dockerfile = dockerfile;
		this.docker = docker;

		this.buildContainer();
	}

	publishDiagnostics() {
		if (this.isDestroyed) {
			return;
		}

		this.sendDiagnostics(this.document.uri, this.DA_problems.concat(this.SA_problems));
	}

	addDiagnostic(severity: DiagnosticSeverity, range: Range, message: string, code?: ValidationCode) {
		this.DA_problems.push(Validator.createDockerliveDiagnostic(severity, range, message, code));
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
							this.log("Stream", parsedData["stream"]);

							if (parsedData["stream"].match(/Step \d+\/\d+ :/)) {
								try {
									const tokenizedData: string[] = parsedData["stream"].split("/");
									currentStep = parseInt(tokenizedData[0].match(/\d+/)[0]);
									//const totalSteps = parseInt(tokenizedData[1].match(/\d+/)[0]);

									this.sendProgress(parsedData["stream"]);
								} catch (e) {
									this.log("Something went wrong parsing Docker build steps...");
								}
							}

							if (parsedData["stream"].match("Successfully built")) {
								this.DA_problems = [];
								this.publishDiagnostics();
								this.runContainer();
							}
						} else if (parsedData["status"]) {
							this.log("Status", parsedData["status"]);
						} else if (parsedData["errorDetail"]) {
							this.addDiagnostic(DiagnosticSeverity.Error, this.dockerfile.getInstructions()[currentStep - 1].getRange(), parsedData["errorDetail"]["message"]);
							this.publishDiagnostics();
							this.log("ErrorDetail", parsedData["errorDetail"]["message"]);
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

	runContainer() {
		this.sendProgress("Creating container...");
		this.docker.createContainer({ Image: 'testimage', Tty: true, name: 'testcontainer' + this.document.version, HostConfig: { PublishAllPorts: true } }, (err, container) => {
			this.container = container;

			if (this.isDestroyed) {
				this.sendProgress(true);
				return;
			}

			if (err) {
				this.log("ERROR CREATING CONTAINER", err);
				this.addDiagnostic(DiagnosticSeverity.Error, this.dockerfile.getENTRYPOINTs()[0].getRange(), "Error creating container - " + err);
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
					this.log("ERROR STARTING CONTAINER", err);
					this.addDiagnostic(DiagnosticSeverity.Error, this.dockerfile.getENTRYPOINTs()[0].getRange(), "Error starting container - " + err);
					this.publishDiagnostics();
					this.sendProgress(true);
					return;
				}
				this.log("STARTED CONTAINER", data);

				this.runNmap();
				this.getPerformance();
				this.getOS();
				this.checkEnvVar();
			});

			container.attach({ stream: true, stdout: true, stderr: true }, (err, stream: Stream) => {
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				if (err) {
					this.log("ERROR ATTACHING TO CONTAINER", err);
					this.addDiagnostic(DiagnosticSeverity.Error, this.dockerfile.getENTRYPOINTs()[0].getRange(), "Error attaching to container - " + err);
					this.publishDiagnostics();
					this.sendProgress(true);
				}
				stream.on('data', (data) => {
					this.log("CONTAINER STDOUT", data);
				});
				stream.on('end', (_) => {
					container.wait((err, data) => {
						this.sendProgress(true);
						if (this.isDestroyed) {
							return;
						}
						if (err) {
							this.log("ERROR GETTING CONTAINER EXIT CODE", err);
							return;
						}
						this.log("CONTAINER CLOSED WITH CODE", data.StatusCode);
						if (data.StatusCode != 0) {
							this.addDiagnostic(DiagnosticSeverity.Error, this.dockerfile.getENTRYPOINTs()[0].getRange(), "Container Exited with code (" + data.StatusCode + ") - See Logs");
							this.publishDiagnostics();
						}
					});
				});
			});
		});
	}

	private async getProcessTree(){
		//TODO - Implement
	}
	
	private async checkEnvVar() {
		let envVars = this.dockerfile.getENVs();
		let parsedEnvVars = {}

		for(let envVar of envVars){
			for(let arg of envVar.getArguments()){
				let splitEnvVar = arg.getValue().split("=");
				parsedEnvVars[splitEnvVar[0]] = {
					value: splitEnvVar[1],
					range: arg.getRange()
				}; //TODO - Resolve variables
			}
		}

		await this.getProcessTree();

		let entrypointEnvVars = await this.execWithStatusCode(["cat","/proc/1/environ"]); //TODO - Not robust, unable to trace the envVar change back to a command and misses some cases, for example "env VAR=value node index.js"

		if(entrypointEnvVars.exitCode != 0){
			this.log("Could not verify envVars at entrypoint",entrypointEnvVars.output.toString().replace(/[^\x20-\x7E|\n]/g, ''));
			return;
		}

		//Entries on file /proc/${pid}/environ are separated by the null character (0x00). Replacing to newline (0x0A).
		entrypointEnvVars.output = Buffer.from(entrypointEnvVars.output.map((value, _index, _arr) => value == 0x00 ? 0x0A : value));
		let sanitized = entrypointEnvVars.output.toString().replace(/[^\x20-\x7E|\n]/g, '').replace(/^\s*\n/gm,'');

		//For each line, surround the value side of the key=value pair with brackets - required by parse-pairs package
		sanitized = sanitized.split("\n").map((value,_index,_arr) => {
			if(!value.includes("=")) return "";
			let splitValue = value.split("=");
			splitValue[1] = `"${splitValue[1]}"`;
			return splitValue.join("=");
		}).join('\n');

		let actualEnvVars = parsePairs(sanitized);
		for(let key of Object.keys(actualEnvVars)){
			if(parsedEnvVars[key] != null && parsedEnvVars[key].value != actualEnvVars[key]){
				this.addDiagnostic(DiagnosticSeverity.Information, parsedEnvVars[key].range, `Environment Variable changed.\nValue at start of execution: ${actualEnvVars[key]}`);
			}
		}

		this.publishDiagnostics();
	}

	private execWithStatusCode(cmd): Promise<ExecData> {
		return new Promise((res, _rej) => {
			this.container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, (err, exec) => {
				if (err) {
					this.log("ERROR CREATING EXEC", cmd, err);
					res(null);
					return;
				}

				let outputBuffers = [];

				exec.start((err, stream) => {
					if (err) {
						this.log("ERROR STARTING EXEC", cmd, err);
						res(null);
						return;
					}

					stream.on('data', async (data: Buffer) => {
						outputBuffers.push(data);
						await new Promise(r => setTimeout(r, 100)); //!- Temporary workaround. See stream.on('end')

						exec.inspect((err, data) => {
							if (err) {
								this.log("ERROR INSPECTING EXEC", cmd, err);
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

					//! - Not being called, hence the necessity to inspect the exec every time data is received
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

		if (lsb_release && lsb_release.exitCode == 0) {
			this.debugLog("Detected OS via", "lsb-release");
			let diagMessage: string = "OS Information: \n\n" + lsb_release.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let issue = await this.execWithStatusCode(['cat', '/etc/issue']);

		if (issue && issue.exitCode == 0) {
			this.debugLog("Detected OS via", "issue");
			let diagMessage: string = "OS Information: \n\n" + issue.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let version = await this.execWithStatusCode(['cat', '/proc/version']);

		if (version && version.exitCode == 0) {
			this.debugLog("Detected OS via", "version");
			let diagMessage: string = "OS Information: \n\n" + version.output.toString().replace(/[^\x20-\x7E|\n]/g, '');

			this.addDiagnostic(DiagnosticSeverity.Hint, fromInstruction.getArgumentsRange(), diagMessage);
			this.publishDiagnostics();
			return;
		}

		let uname = await this.execWithStatusCode(['uname']);

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

	private runNmap() {
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

		this.container.inspect((err, data) => {
			if (err) {
				this.log("ERROR INSPECTING CONTAINER", err);
				this.sendProgress(true);
				return;
			}
			if (this.isDestroyed) {
				this.sendProgress(true);
				return;
			}
			const mappings = data.NetworkSettings.Ports;
			for (let i = 0; i < rangesInFile.length; i++) {
				mappedPorts.push(parseInt(mappings[ports[i] + "/" + protocols[i]][0].HostPort));
			}

			let tcpMappedPorts = mappedPorts.filter((_value, index, _array) => protocols[index] == "tcp");

			this.sendProgress("Running nmap...");

			const nmapCommand = `nmap -oX - 127.0.0.1 -p ${tcpMappedPorts.join(",")} -sV`;

			this.log("Running: " + nmapCommand);

			child_process.exec(nmapCommand, (err: child_process.ExecException, stdout: string, _stderr: string) => {
				if (err) {
					this.log("ERROR EXECUTING NMAP", err.message);
					this.sendProgress(true);
					return;
				}
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				xml2js.parseString(stdout, (err: Error, result) => {
					if (err) {
						this.log("ERROR PARSING NMAP OUTPUT XML", err.message);
						this.sendProgress(true);
						return;
					}
					try {
						const nmapPorts: Array<any> = result['nmaprun']['host']['0']['ports']['0']['port'];
						for (const nmapPort of nmapPorts) {
							const portID = parseInt(nmapPort['$']['portid']);
							const protocol = nmapPort['$']['protocol'];
							const serviceName = nmapPort['service'][0]['$']['name'];
							const serviceProduct = nmapPort['service'][0]['$']['product'];
							const serviceExtrainfo = nmapPort['service'][0]['$']['extrainfo'];

							const index = mappedPorts.findIndex((value, _index, _obj) => (value == portID));

							//? Assumes that when nmap can't identify the service there's nothing running there. 
							//? https://security.stackexchange.com/questions/23407/how-to-bypass-tcpwrapped-with-nmap-scan
							//? If this assumption is proven wrong, fallback on inspec to check if the port is listening
							if (serviceName != "tcpwrapped") {
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

								this.addDiagnostic(DiagnosticSeverity.Hint, rangesInFile[index], msg);
							} else {
								this.addDiagnostic(DiagnosticSeverity.Error, rangesInFile[index], `Port ${ports[index]} (exposed on ${portID}) - Could not detect service running`);
							}
						}
						this.publishDiagnostics();

						this.sendProgress(true); //! - Probably will need to change when implementing inspec / other feedback
					} catch (e) {
						this.log("ERROR PARSING NMAP OUTPUT OBJECT", e, "WITH NMAP OUTPUT", JSON.stringify(result));
						this.sendProgress(true);
					}
				});
			})
		});
	}

	//Based on https://github.com/moby/moby/blob/eb131c5383db8cac633919f82abad86c99bffbe5/cli/command/container/stats_helpers.go#L175-L188
	private calculateCPUPercent(stats) {
		let cpuPercent = 0;
		let cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
		let systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
		let cpuCount = stats.cpu_stats.cpu_usage.percpu_usage.length;

		if (systemDelta && cpuDelta) {
			cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100;
		}

		return cpuPercent;
	}

	private calculateNetworks(stats) {
		let rawNetworks = stats.networks;
		let finalNetworks = {};

		for (let key of Object.keys(rawNetworks)) {
			finalNetworks[key] = {
				input: rawNetworks[key].rx_bytes,
				output: rawNetworks[key].tx_bytes
			};
		}

		return finalNetworks;
	}

	//Based on https://github.com/moby/moby/blob/eb131c5383db8cac633919f82abad86c99bffbe5/cli/command/container/stats_helpers.go#L106-L125
	private calculateStorage(stats) {
		let readBytes = 0;
		let writeBytes = 0;

		if (process.platform === "win32") {
			readBytes = stats.storage_stats.read_size_bytes || 0;
			writeBytes = stats.storage_stats.write_size_bytes || 0;
		} else {
			for (let entry of stats.io_service_bytes_recursive) {
				if (entry.op == "read") {
					readBytes += entry.value;
				} else if (entry.op == "write") {
					writeBytes += entry.value;
				}
			}
		}

		return {
			readBytes: readBytes,
			writeBytes: writeBytes
		}
	}

	private getPerformance() {
		if (this.isDestroyed) {
			return;
		}

		this.container.stats((err, stream) => {
			if (err) {
				this.log(err);
				return;
			}

			if (this.isDestroyed) {
				return;
			}

			stream.on('data', (data: Buffer) => {
				//this.log("STATS RECEIVED");
				let parsedData = JSON.parse(data.toString());

				this.sendPerformanceStats({
					running: true,
					cpu: {
						percentage: this.calculateCPUPercent(parsedData) //TODO - Double check that this works for unix systems
					},
					memory: {
						usage: parsedData.memory_stats.usage,
						limit: parsedData.memory_stats.limit
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

	destroy() {
		this.isDestroyed = true;

		this.log("Destroying Analysis");

		this.sendProgress(true);

		if (this.buildStream) {
			try {
				this.buildStream.destroy();
				this.log("Build Stream Terminated");
			} catch (e) {
				this.log("Could not destroy build stream - " + e);
			}
		}

		if (this.container) {
			try {
				this.container.remove({ v: true, force: true });
				this.log("Container Terminated");
			} catch (e) {
				this.log("Could not remove container - " + e);
			}
		}

		if (this.performanceTimeout) {
			clearInterval(this.performanceTimeout);
			this.log("Stopped retrieving performance");
		}
	}

	debugLog(...msgs: String[]) {
		if (DEBUG)
			this.log(...msgs);
	}

	log(...msgs: String[]) {
		if (DEBUG) {
			console.log("[" + this.document.version + "] " + msgs.join(": "));
		} else {
			console.log(stripAnsi(msgs[msgs.length - 1].toString()));
		}
	}
}

function json_escape(str: string) {
	return str.replace("\\n", "").replace("\n", "");
} 