import {
	TextDocument, Range, Diagnostic, DiagnosticSeverity, CodeLens
} from 'vscode-languageserver-types';
import { Validator } from './dockerValidator';
import { ValidationCode } from './main';
import { Dockerfile, Instruction } from 'dockerfile-ast';
import Dockerode from 'dockerode';
import { Duplex } from 'stream';
import { getFilesystem } from './filesystemAnalysis';
import { buildContainer, getLayerData } from './buildContainer';
import { runContainer } from './runContainer';
import { getRunningProcesses } from './runningProcesses';
import { detectEnvChange, checkEnvVar } from './envVars';
import { getOS } from './osDiscovery';
import { runServiceDiscovery, runNmap } from './serviceDiscovery';
import { getPerformance } from './performance';
import { execWithStatusCode } from './execInsideContainer';
var stripAnsi = require("strip-ansi");

export const DEBUG = false;

export class DynamicAnalysis {
	public buildStream: Duplex;
	public document: TextDocument;
	public sendDiagnostics: Function;
	public sendProgress: Function;
	public sendPerformanceStats: Function;
	public sendFilesystemData: Function;
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
	public analysisID: number;

	//Exported Functions
	public getFilesystem = getFilesystem;
	public buildContainer = buildContainer;
	public getLayerData = getLayerData;
	public runContainer = runContainer;
	public getRunningProcesses = getRunningProcesses;
	public detectEnvChange = detectEnvChange;
	public checkEnvVar = checkEnvVar;
	public getOS = getOS;
	public runServiceDiscovery = runServiceDiscovery;
	public runNmap = runNmap;
	public getPerformance = getPerformance;
	public execWithStatusCode = execWithStatusCode;

	get containerName(): string {
		return 'testcontainer' + this.analysisID;
	}

	constructor(document: TextDocument, sendDiagnostics: Function, sendProgress: Function, sendPerformanceStats: Function, sendFilesystemData: Function, sendCodeLenses: Function, SA_problems: Diagnostic[], dockerfile: Dockerfile, docker: Dockerode) {
		this.analysisID = Math.floor(Math.random() * Math.floor(100000000000));

		this.document = document;
		this.sendDiagnostics = sendDiagnostics;
		this.sendProgress = sendProgress;
		this.sendPerformanceStats = sendPerformanceStats;
		this.sendFilesystemData = sendFilesystemData;
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

		this.sendCodeLenses(this.document.uri, this.codeLenses);
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

	restart(): DynamicAnalysis {
		this.destroy();
		return new DynamicAnalysis(this.document, this.sendDiagnostics, this.sendProgress, this.sendPerformanceStats, this.sendFilesystemData, this.sendCodeLenses, this.SA_problems, this.dockerfile, this.docker);
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