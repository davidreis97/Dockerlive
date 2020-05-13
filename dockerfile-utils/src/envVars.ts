import { DiagnosticSeverity } from 'vscode-languageserver-types';
import { DynamicAnalysis } from './dynamicAnalysis';

const MAX_ANALYSED_PROCESSES = 10;

export async function detectEnvChange(this: DynamicAnalysis, parsedEnvVars, process): Promise<any> {
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

export async function checkEnvVar(this: DynamicAnalysis) {
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

function parsePairs(str) {
	let obj = {};
	for (let line of str.split('\n')) {
		let splitLine = line.split("=");
		obj[splitLine[0]] = splitLine.slice(1).join("=");
	}
	return obj;
}