import { DynamicAnalysis } from './dynamicAnalysis';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import { table } from 'table';

interface ContainerProcess {
	pid: number,
	ppid: number,
	cmd: string,
	children?: ContainerProcess[]
}

export async function getRunningProcesses(this: DynamicAnalysis): Promise<ContainerProcess[]> {
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