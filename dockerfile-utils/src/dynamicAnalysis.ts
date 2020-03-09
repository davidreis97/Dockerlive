import {
	TextDocument, Range, Position, Diagnostic, DiagnosticSeverity
} from 'vscode-languageserver-types';
import { Validator } from './dockerValidator';
import { ValidationCode } from './main';
import { Instruction, Keyword } from 'dockerfile-ast';
import Dockerode from 'dockerode';
import uri2path = require('file-uri-to-path');
import path = require('path');
import fs from 'fs';
import tar from 'tar-fs';
import { Stream, Duplex } from 'stream';
import child_process from 'child_process';
import xml2js from 'xml2js';
const stripAnsi = require('strip-ansi');

export const DEBUG = false;

export class DynamicAnalysis {
	public stream: Duplex;
	public document: TextDocument;
	public sendDiagnostics: Function;
	public sendProgress: Function;
	public DA_problems: Diagnostic[];
	public SA_problems: Diagnostic[];
	public instructions: Instruction[];
	public entrypoint: Instruction;
	public docker: Dockerode;
	public container: any;

	public isDestroyed: boolean = false;

	constructor(document: TextDocument, sendDiagnostics: Function, sendProgress: Function, SA_problems: Diagnostic[], instructions: Instruction[], entrypoint: Instruction, docker: Dockerode) {
		this.document = document;
		this.sendDiagnostics = sendDiagnostics;
		this.sendProgress = sendProgress;
		this.DA_problems = [];
		this.SA_problems = SA_problems;
		this.instructions = instructions;
		this.entrypoint = entrypoint;
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
			this.stream = stream;
			let currentStep: number = 1;

			if (error) {
				this.log(error);
				return;
			}

			if (this.isDestroyed) {
				return;
			}

			stream.on('end', () => {
				if (DEBUG)
					this.log("End of Stream");
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
							this.addDiagnostic(DiagnosticSeverity.Error, this.instructions[currentStep - 1].getRange(), parsedData["errorDetail"]["message"]);
							this.publishDiagnostics();
							this.log("ErrorDetail", parsedData["errorDetail"]["message"]);
						} else {
							if (DEBUG) {
								this.log("Other", data.toString());
							}
						}
					} catch (e) {
						if (DEBUG && data.toString()) {
							this.log("Skipped build message", data.toString(), "Due to", e);
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
				this.addDiagnostic(DiagnosticSeverity.Error, this.entrypoint.getRange(), "Error creating container - " + err);
				this.publishDiagnostics();
				this.sendProgress(true);
			}

			this.sendProgress("Starting container...");
			container.start((err, data) => {
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				if (err) {
					this.log("ERROR STARTING CONTAINER", err);
					this.addDiagnostic(DiagnosticSeverity.Error, this.entrypoint.getRange(), "Error starting container - " + err);
					this.publishDiagnostics();
					this.sendProgress(true);
				}
				this.log("STARTED CONTAINER", data);

				this.runNmap();
			});

			container.attach({ stream: true, stdout: true, stderr: true }, (err, stream: Stream) => {
				if (this.isDestroyed) {
					this.sendProgress(true);
					return;
				}
				if (err) {
					this.log("ERROR ATTACHING TO CONTAINER", err);
					this.addDiagnostic(DiagnosticSeverity.Error, this.entrypoint.getRange(), "Error attaching to container - " + err);
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
						}
						this.log("CONTAINER CLOSED WITH CODE " + data.StatusCode);
						if (data.StatusCode != 0) {
							this.addDiagnostic(DiagnosticSeverity.Error, this.entrypoint.getRange(), "Container Exited with code (" + data.StatusCode + ") - See Logs");
							this.publishDiagnostics();
						}
					});
				});
			});
		});
	}

	private runNmap() {
		const rangesInFile: Range[] = [];
		const ports: number[] = [];
		const protocols: string[] = [];
		const mappedPorts: number[] = [];

		for (let instruction of this.instructions) {
			if (instruction.getInstruction() == Keyword.EXPOSE) {
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
						this.sendDiagnostics(this.document.uri, this.DA_problems.concat(this.SA_problems));

						this.sendProgress(true); //! - Probably will need to change when implementing inspec / other feedback
					} catch (e) {
						this.log("ERROR PARSING NMAP OUTPUT OBJECT", e, "WITH NMAP OUTPUT", JSON.stringify(result));
						this.sendProgress(true);
					}
				});
			})
		});
	}

	destroy() {
		this.isDestroyed = true;

		this.log("Destroying Analysis");

		this.sendProgress(true);

		if (this.stream) {
			try {
				this.stream.destroy();
				this.log("Build Stream Terminated")
			} catch (e) {
				this.log("Could not destroy stream - " + e);
			}
		}

		if (this.container) {
			try {
				this.container.remove({ v: true, force: true });
				this.log("Container Terminated")
			} catch (e) {
				this.log("Could not remove container - " + e);
			}
		}
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