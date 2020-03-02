import {
    TextDocument, Range, Position, Diagnostic, DiagnosticSeverity
} from 'vscode-languageserver-types';
import { Duplex } from 'stream';
import { Validator, DEBUG } from './dockerValidator';
import { ValidationCode } from './main';
const stripAnsi = require('strip-ansi');

export class DynamicAnalysis{
	public version: number;
	public diagnostics: Diagnostic[];
	public stream: Duplex;
	public container: any;

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
			this.log("Build Stream Terminated")
		}catch(e){
			this.log("Could not destroy stream - " + e);
		}

		if (this.container){
			try{
				this.container.remove({v: true, force: true});
				this.log("Container Terminated")
			}catch(e){
				this.log("Could not remove container - " + e);
			}	
		}
	}

	log(...msgs: String[]){
		if(DEBUG){
			console.log("[" + this.version + "] " + msgs.join(": "));
		}else{
			console.log(stripAnsi(msgs[msgs.length-1].toString()));
		}
	}
}