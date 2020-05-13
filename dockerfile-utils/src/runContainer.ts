import { DynamicAnalysis } from './dynamicAnalysis';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import { Stream } from 'stream';

const CHECK_PROCESSES_INTERVAL = 500; //ms

export function runContainer(this: DynamicAnalysis) {
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
			this.destroy();
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
				this.destroy();
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
					return;
				}

				stream.on('data', (data) => {
					this.log(data);
				});
			});
		});
	});
}