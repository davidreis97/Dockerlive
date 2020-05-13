import { DynamicAnalysis } from './dynamicAnalysis';
import { DiagnosticSeverity, Range } from 'vscode-languageserver-types';
import child_process from 'child_process';
import { Keyword } from 'dockerfile-ast';
import xml2js from 'xml2js';

export function runServiceDiscovery(this: DynamicAnalysis) {
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

export function runNmap(this: DynamicAnalysis, tcpMappedPorts, mappedPorts, rangesInFile, ports) {
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