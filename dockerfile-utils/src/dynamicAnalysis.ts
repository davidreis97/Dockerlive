import {
    TextDocument, Range, Position, Diagnostic, DiagnosticSeverity
} from 'vscode-languageserver-types';
import { Duplex } from 'stream';
import { Validator } from './dockerValidator';
import { ValidationCode } from './main';

export class DynamicAnalysis{
	public version: number;
	public diagnostics: Diagnostic[];
	public stream: Duplex;

	constructor(stream: Duplex, version: number){
		this.version = version;
		this.stream = stream;
		this.diagnostics = [];
	}

	addDiagnostic(severity: DiagnosticSeverity, range: Range, message: string, code ?: ValidationCode){
		this.diagnostics.push(Validator.createDockerliveDiagnostic(severity,range,message,code));
	}

	destroy(){
		try{
			this.stream.destroy();
		}catch(e){
			this.log("Could not destroy stream - " + e);
		}
		this.log("Stream Terminated")
	}

	log(msg: String){
		console.log("[" + this.version + "] " + msg);
	}
}