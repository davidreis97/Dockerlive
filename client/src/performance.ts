export class PerformanceGraphs {
	cpuPercentages: Array<number>;
	memoryUsages: Array<number>;
	maxMemory: number;
	networks: any;
	readBytes: Array<number>;
	writeBytes: Array<number>;
	nextDataIsFromNewContainer: boolean;

	readonly historySize: number = 50; //Number of points in the graph

	constructor() {
		this.cpuPercentages = new Array(this.historySize);
		this.memoryUsages = new Array(this.historySize);
		this.readBytes = new Array(this.historySize);
		this.writeBytes = new Array(this.historySize);
		this.networks = {};
		this.maxMemory = 0;

		this.clearGraphs();
	}

	update(data) {
		if (this.nextDataIsFromNewContainer) { //Clear the previous data when a new container starts running but leave the data intact when the container stops without a new one coming in
			this.clearGraphs();
		}

		if (!data.running) {
			this.nextDataIsFromNewContainer = true;
		} else {
			this.nextDataIsFromNewContainer = false;

			this.cpuPercentages.shift();
			this.cpuPercentages.push(data.cpu.percentage);

			this.maxMemory = data.memory.limit;
			this.memoryUsages.shift();
			this.memoryUsages.push(data.memory.usage);

			for (let key of Object.keys(data.networks)) {
				if (!this.networks[key]) {
					this.networks[key] = {
						input: new Array(this.historySize).fill(0),
						output: new Array(this.historySize).fill(0),
					};
				}

				this.networks[key].input.shift();
				this.networks[key].input.push(data.networks[key].input);

				this.networks[key].output.shift();
				this.networks[key].output.push(data.networks[key].output);
			}

			this.readBytes.shift();
			this.readBytes.push(data.storage.readBytes);

			this.writeBytes.shift();
			this.writeBytes.push(data.storage.writeBytes);
		}

		return {
			cpu: this.cpuPercentages,
			memory: {
				usage: this.memoryUsages,
				limit: this.maxMemory
			},
			networks: this.networks,
			storage: {
				readBytes: this.readBytes,
				writeBytes: this.writeBytes
			}
		}
	}

	clearGraphs() {
		this.cpuPercentages.fill(0);
		this.memoryUsages.fill(0);
		this.readBytes.fill(0);
		this.writeBytes.fill(0);
		this.networks = {};
		this.maxMemory = 0;
	}

	getHTML(css,js,chartjs) {
		return /*html*/`
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Performance</title>
			</head>

			<link rel="stylesheet" href="${css}">

			<body>
				<div id="container">
					<button onclick="stop();">Stop</button>
					<button onclick="restartBuild();">Restart</button>
					<button onclick="openShell();">Open Shell</button>
				</div>

				<div id="cpuDiv">
					<canvas id="cpu"></canvas>					
				</div>
				
				<div id="memoryDiv">
					<canvas id="memory"></canvas>
				</div>

				<div id="networks">
					<!-- Canvas initialized in Javascript -->
				</div>

				<div id="storageDiv">
					<canvas id="storage"></canvas>
				</div>
				
				<script src="${chartjs}"></script>
				<script src="${js}"> </script>
			</body>
		</html>
		`;
	}
}