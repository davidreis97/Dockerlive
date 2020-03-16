export class PerformanceGraphs {
	cpuPercentages: Array<number>;
	memoryUsages: Array<number>;
	maxMemory: number;
	networks: any;
	readBytes: Array<number>;
	writeBytes: Array<number>;
	nextDataIsFromNewContainer: boolean;

	readonly historySize : number = 50; //Number of points in the graph

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
		if(this.nextDataIsFromNewContainer){ //Clear the previous data when a new container starts running but leave the data intact when the container stops without a new one coming in
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

			for(let key of Object.keys(data.networks)){
				if(!this.networks[key]){
					this.networks[key] = {
						input : new Array(this.historySize).fill(0),
						output : new Array(this.historySize).fill(0),
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

	getHTML() { //! Would be best if the Chart.js dependency was local stored instead of CDN delivered
		return /*html*/`
			<!DOCTYPE html>
			<html lang="en">
			
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Dockerlive</title>
			</head>

			<style type="text/css">
				div#cpuDiv, div#memoryDiv, div.networkDiv, div#storageDiv{
					margin-top: 0.5em;
					width:100%;
					height:200px;
				}
			</style>
			
			<body>
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
				
				<!-- TODO - Convert to local dependency -->
				<script src="https://cdn.jsdelivr.net/npm/chart.js@2.9.3/dist/Chart.min.js"></script>
				<script>
					let darkMode = (document.getElementsByClassName("vscode-dark").length > 0);

					let cpuCanvas = document.getElementById('cpu').getContext('2d');
					let cpuChart = new Chart(cpuCanvas, {
						type: 'line',
						data: {
							labels: [],
							datasets: [{
								label: 'CPU (%)',
								data: [],
								backgroundColor: 'rgba(255, 99, 132, 0.2)',
								borderColor: 'rgba(255, 99, 132, 1)',
							}]
						},
						options: {
							responsive: true,
    						maintainAspectRatio: false,
							legend: {
								labels: {
									fontColor: getColor("text"),
									fontSize: 18
								}
							},
							tooltips: {
								enabled: false
							},
							scales: {
								yAxes: [{
									gridLines: {
										color: getColor("gridLines"),
									},
									ticks: {
										fontColor: getColor("text"),
										suggestedMin: 0,
										suggestedMax: 100,
										userCallback: function(item, index) {
											if (!(item % 20)) return item;
										}
									},
								}],
								xAxes: [{
									scaleLabel: {
										fontColor: getColor("text"),
										display: true,
										labelString: "Time elapsed (s)"
									},
									gridLines: {
										display: false,
									},
									ticks: {
										fontColor: getColor("text"),
										maxRotation: 0,
										userCallback: function(item, index) {
											if (!(item % 5)) return item;
										}
									}
								}]
							}
						}
					});

					let memoryCanvas = document.getElementById('memory').getContext('2d');
					let memoryChart = new Chart(memoryCanvas, {
						type: 'line',
						data: {
							labels: [],
							datasets: [{
								label: 'Memory (MB)',
								data: [],
								backgroundColor: 'rgba(99, 255, 132, 0.2)',
								borderColor: 'rgba(99, 255, 132, 1)',
							}]
						},
						options: {
							responsive: true,
    						maintainAspectRatio: false,
							legend: {
								labels: {
									fontColor: getColor("text"),
									fontSize: 16
								}
							},
							tooltips: {
								enabled: false
							},
							scales: {
								yAxes: [{
									gridLines: {
										color: getColor("gridLines"),
									},
									ticks: {
										fontColor: getColor("text"),
										suggestedMin: 0,
										suggestedMax: 10000,
										maxTicksLimit: 7,
										userCallback: function(item, index) {
											return item / 1000000;
										}
									},
								}],
								xAxes: [{
									scaleLabel: {
										fontColor: getColor("text"),
										display: true,
										labelString: "Time elapsed (s)"
									},
									gridLines: {
										display: false,
									},
									ticks: {
										fontColor: getColor("text"),
										maxRotation: 0,
										userCallback: function(item, index) {
											if (!(item % 5)) return item;
										}
									}
								}]
							}
						}
					});

					let storageCanvas = document.getElementById('storage').getContext('2d');
					let storageChart = new Chart(storageCanvas, {
						type: 'line',
						data: {
							labels: [],
							datasets: [{
								label: 'Storage Read (MB)',
								data: [],
								backgroundColor: 'rgba(132, 255, 99, 0.2)',
								borderColor: 'rgba(132, 255, 99, 1)',
							},
							{
								label: 'Storage Write (MB)',
								data: [],
								backgroundColor: 'rgba(132, 99, 255, 0.2)',
								borderColor: 'rgba(132, 99, 255, 1)',
							}]
						},
						options: {
							responsive: true,
    						maintainAspectRatio: false,
							legend: {
								labels: {
									fontColor: getColor("text"),
									fontSize: 16
								}
							},
							tooltips: {
								enabled: false
							},
							scales: {
								yAxes: [{
									gridLines: {
										color: getColor("gridLines"),
									},
									ticks: {
										fontColor: getColor("text"),
										suggestedMin: 0,
										suggestedMax: 10000,
										maxTicksLimit: 7,
										userCallback: function(item, index) {
											return item / 1000000;
										}
									},
								}],
								xAxes: [{
									scaleLabel: {
										fontColor: getColor("text"),
										display: true,
										labelString: "Time elapsed (s)"
									},
									gridLines: {
										display: false,
									},
									ticks: {
										fontColor: getColor("text"),
										maxRotation: 0,
										userCallback: function(item, index) {
											if (!(item % 5)) return item;
										}
									}
								}]
							}
						}
					});

					let networkCharts = {};

					window.addEventListener('message', event => {
						const message = event.data;
						
						console.log(message);

						if(cpuChart.data.labels.length == 0){
							cpuChart.data.labels = message.cpu.map((_val,index,_arr) => message.cpu.length - index);
						}
						cpuChart.data.datasets[0].data = message.cpu;
						cpuChart.update(0);

						if(memoryChart.data.labels.length == 0){
							memoryChart.data.labels = message.memory.usage.map((_val,index,_arr) => message.memory.usage.length - index);
						}
						memoryChart.data.datasets[0].data = message.memory.usage;
						//memoryChart.options.scales.yAxes[0].ticks.suggestedMax = message.memory.limit;

						memoryChart.update(0);

						for(interfaceName of Object.keys(message.networks)){
							if(!document.getElementById(interfaceName)){
								let networks = document.getElementById("networks");
								let networkDiv = document.createElement("div");
								networkDiv.className = "networkDiv";
								let networkCanvas = document.createElement("canvas");
								networkCanvas.id = interfaceName;
								networkDiv.appendChild(networkCanvas);
								networks.appendChild(networkDiv);

								networkCharts[interfaceName] = new Chart(networkCanvas, {
									type: 'line',
									data: {
										labels: [],
										datasets: [{
											label: 'Network Input - ' + interfaceName + ' (MB)',
											data: [],
											backgroundColor: 'rgba(99, 132, 255, 0.2)',
											borderColor: 'rgba(99, 132, 255, 1)',
										},
										{
											label: 'Network Output - ' + interfaceName + ' (MB)',
											data: [],
											backgroundColor: 'rgba(255, 132, 99, 0.2)',
											borderColor: 'rgba(255, 132, 99, 1)',
										}]
									},
									options: {
										responsive: true,
										maintainAspectRatio: false,
										legend: {
											labels: {
												fontColor: getColor("text"),
												fontSize: 16
											}
										},
										tooltips: {
											enabled: false
										},
										scales: {
											yAxes: [{
												gridLines: {
													color: getColor("gridLines"),
												},
												ticks: {
													fontColor: getColor("text"),
													suggestedMin: 0,
													suggestedMax: 10000,
													maxTicksLimit: 7,
													userCallback: function(item, index) {
														return item / 1000000;
													}
												},
											}],
											xAxes: [{
												scaleLabel: {
													fontColor: getColor("text"),
													display: true,
													labelString: "Time elapsed (s)"
												},
												gridLines: {
													display: false,
												},
												ticks: {
													fontColor: getColor("text"),
													maxRotation: 0,
													userCallback: function(item, index) {
														if (!(item % 5)) return item;
													}
												}
											}]
										}
									}
								});
							}

							if(networkCharts[interfaceName].data.labels.length == 0){
								networkCharts[interfaceName].data.labels = message.networks[interfaceName].input.map((_val,index,_arr) => message.networks[interfaceName].input.length - index);
							}
							networkCharts[interfaceName].data.datasets[0].data = message.networks[interfaceName].input;
							networkCharts[interfaceName].data.datasets[1].data = message.networks[interfaceName].output;
							networkCharts[interfaceName].update(0);
						}

						for(let interfaceName of Object.keys(networkCharts)){
							if(!message.networks.hasOwnProperty(interfaceName) && networkCharts[interfaceName] != null){
								networkCharts[interfaceName] = null;

								let canvas = document.getElementById(interfaceName);
								canvas.parentNode.parentNode.removeChild(canvas.parentNode); //Remove the parent div of the canvas
							}
						}

						if(storageChart.data.labels.length == 0){
							storageChart.data.labels = message.storage.readBytes.map((_val,index,_arr) => message.storage.readBytes.length - index);
						}
						storageChart.data.datasets[0].data = message.storage.readBytes;
						storageChart.data.datasets[1].data = message.storage.writeBytes;
						storageChart.update(0);
					});

					function getColor(attribute){
						switch(attribute){
							case "gridLines":
								return darkMode ? 'rgba(200, 200, 200, 0.4)' : 'rgba(30, 30, 30, 0.4)';
								break;
							case "text":
								return darkMode ? 'rgba(244, 244, 244, 1)' : 'rgba(20, 20, 20, 1)';
								break;
							default:
								console.error("Unknown color attribute: [" + attribute + "]");
								break;
						}
					}
				</script>
			</body>
			
			</html>
		`;
	}
}