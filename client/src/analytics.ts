import uuid from 'uuid';
import TelemetryReporter from 'vscode-extension-telemetry';

export class Analytics {
	private readonly key : string = "56d9f650-1593-4fc4-9eda-5556ee965c3d";
	public reporter : TelemetryReporter;

	private ongoingEvents = {};

	constructor(extensionId: string, extensionVersion: string){
		this.reporter = new TelemetryReporter(extensionId,extensionVersion,this.key);
	}

	public sendEvent(name: string, properties?: { [key: string]: string; }, measurements?: { [key: string]: number; }){
		this.reporter.sendTelemetryEvent(name, properties, measurements);
	}

	public startEvent(name: string){
		if(!this.ongoingEvents[name]){
			this.ongoingEvents[name] = new Date().getTime();
		}
	}

	public stopEvent(name: string, properties?: { [key: string]: string; }, measurements?: { [key: string]: number; }){
		if(!this.ongoingEvents[name]){
			return;
		}

		let duration = Math.floor((new Date().getTime() - this.ongoingEvents[name]) / 1000.0);
		this.sendEvent(name, properties, {...measurements, duration});
		this.ongoingEvents[name] = null;
	}

	public stopAllEvents(){
		for(let name of Object.keys(this.ongoingEvents)){
			this.stopEvent(name);
		}
	}
}