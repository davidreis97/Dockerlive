import { DynamicAnalysis } from './dynamicAnalysis';
import { DiagnosticSeverity } from 'vscode-languageserver-types';

/*
	1st try - cat /etc/os-release
	2nd try - cat /etc/lsb-release
	3rd try - cat /etc/issue
	4th try - cat /proc/version
	5th try - uname

	If all fails, probably not a linux distribution
*/
export async function getOS(this: DynamicAnalysis) {
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
